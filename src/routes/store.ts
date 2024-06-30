import { Router } from 'express';
import { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { PrismaClient } from '@prisma/client';
import Shopify, { IOrder as ShopifyOrder } from 'shopify-api-node';
import { format } from 'date-fns';
import { getDatesInMonth } from '../utils/date';

const router = Router();
const prisma = new PrismaClient();

router.post('/create', authMiddleware , async(req: any, res: Response) => {
    const userId = req.user.userId
    const { name, accessToken, shopifyName} = req.body

    try {
        const newStore = await prisma.store.create({
            data: {
                name,
                shopifyName,
                accessToken,
                userId,
            }
        })

        res.status(201).json({
            message: `${name} store created successfully`,
            storeId: newStore.id,
        })
    } catch(e) {
        res.status(500).json({
            error: "Failed to create store"
        })
    }
})

router.get('/', authMiddleware, async(req: any, res: Response) => {
    const userId = req.user.userId
    
    try {
        const stores = await prisma.store.findMany({
            where: {
                userId: userId,
            },
            select: {
                id: true,
                name: true,
            }
        })
        res.status(200).json({
            stores
        })
    } catch(e) {
        res.status(500).json({
            error: "Failed to fetch stores"
        })
    }
})

interface SyncOrdersRequest {
  shopId: string;
}

interface Store {
  shopifyName: string;
  accessToken: string;
}

const fetchAndProcessOrders = async (shopify: Shopify, shopId: string, currentTime: Date): Promise<void> => {
  let params: any = { 
    limit: 250,
    created_at_max: currentTime.toISOString(),
  };

  do {
    try {
      console.log('Fetching orders with params:', params);

      const orders = await shopify.order.list(params);
      console.log('Fetched orders:', orders.length);

      // Insert orders into the database
      for (const order of orders) {
        const paid = parseFloat(order.total_price);
        const tax = parseFloat(order.total_tax);
        const cogs = (paid - tax) * 0.34;
        const grossProfit = paid - cogs;

        await prisma.order.create({
          data: {
            date: new Date(order.created_at),
            orderId: order.id.toString(),
            customer: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Unknown',
            customerId: order.customer?.id.toString(),
            fulfillmentStatus: order.fulfillment_status ? order.fulfillment_status : "Unfulfilled",
            paid: paid,
            tax: tax,
            shippingCost: parseFloat((order.total_shipping_price_set?.presentment_money.amount).toString()) || 0,
            discount: parseFloat(order.total_discounts || "0"),
            grossProfit: grossProfit,
            cogs: cogs,
            storeId: shopId,
            lineItems: {
              create: order.line_items.map(item => {
                const itemPaid = parseFloat(item.price) * item.quantity;
                const preTaxGrossProfit = itemPaid * 0.66;
                const productCost = itemPaid - preTaxGrossProfit;
                return {
                  lineItemId: item.id.toString(),
                  productId: item.product_id?.toString() || "",
                  variantId: item.variant_id?.toString() || "",
                  name: item.variant_title || item.title,
                  quantity: item.quantity,
                  paid: itemPaid,
                  discount: parseFloat(item.total_discount),
                  productCost: productCost,
                  preTaxGrossProfit: preTaxGrossProfit,
                  preTaxGrossMargin: 66
                };
              })
            }
          }
        });
      }

      // Update pagination parameters
      const page_info = orders.nextPageParameters?.page_info;
      params = {
        limit: 250,
        page_info,
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
      throw error;
    }
  } while (params.page_info !== undefined);
};

router.post('/sync-orders', async (req: Request, res: Response) => {
  const { shopId }: SyncOrdersRequest = req.body;

  if (!shopId) {
    return res.status(400).send('Missing required parameter: shopId');
  }

  try {
    // Fetch shop details from the database
    const store: Store | null = await prisma.store.findUnique({
      where: { id: shopId },
      select: { shopifyName: true, accessToken: true }
    });

    if (!store) {
      return res.status(404).send('Store not found');
    }

    const { shopifyName: shopName, accessToken } = store;

    const shopify = new Shopify({
      shopName: shopName,
      accessToken: accessToken,
    });

    const currentTime = new Date();

    // Fetch and process orders in batches
    await fetchAndProcessOrders(shopify, shopId, currentTime);

    await prisma.store.update({
      where: { id: shopId },
      data: { lastOrderSync: currentTime },
    });

    res.status(200).send('Orders and LineItems have been synced successfully.');
  } catch (error) {
    console.error('Error syncing orders:', error);
    res.status(500).send('Internal Server Error');
  }
});


router.post('/resync-orders', async (req: Request, res: Response) => {
  const { shopId } = req.body;

  if (!shopId) {
    return res.status(400).send('Missing required parameter: shopId');
  }

  try {
    // Fetch store information from the database using shopId
    const store = await prisma.store.findUnique({
      where: { id: shopId },
    });

    if (!store) {
      return res.status(404).send('Store not found');
    }

    const { shopifyName: shopName, accessToken, lastOrderSync } = store;
    const shopify = new Shopify({
      shopName: shopName,
      accessToken: accessToken,
    });

    // Get the current time
    const currentTime = new Date();

    let hasMoreOrders = true;
    let params: any = {
      limit: 250,
      created_at_min: lastOrderSync.toISOString(),
      created_at_max: currentTime.toISOString(),
    };

    while (hasMoreOrders) {
      const orders = await shopify.order.list(params);

      if (orders.length < params.limit) {
        hasMoreOrders = false;
      } else {
        const lastOrder = orders[orders.length - 1];
        params = { ...params, page_info: lastOrder.id };
      }

      for (const order of orders) {
        // Calculate grossProfit and cogs for the order
        const paid = parseFloat(order.total_price);
        const tax = parseFloat(order.total_tax)
        const cogs = (paid - tax) * 0.34;
        const grossProfit = paid - cogs;

        await prisma.order.create({
          data: {
            date: new Date(order.created_at),
            orderId: order.id.toString(),
            customer: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Unknown',
            customerId: order.customer?.id.toString(),
            fulfillmentStatus: order.fulfillment_status ? order.fulfillment_status : "Unfulfilled",
            paid: paid,
            tax: tax,
            shippingCost: parseFloat((order.total_shipping_price_set?.presentment_money.amount).toString()) || 0,
            discount: parseFloat(order.total_discounts || "0"),
            grossProfit: grossProfit,
            cogs: cogs,
            storeId: shopId,
            lineItems: {
              create: order.line_items.map(item => {
                const itemPaid = parseFloat(item.price) * item.quantity;
                const preTaxGrossProfit = itemPaid * 0.66;
                const productCost = itemPaid - preTaxGrossProfit;
                return {
                  lineItemId: item.id.toString(),
                  productId: item.product_id?.toString() || "",
                  variantId: item.variant_id?.toString() || "",
                  name: item.variant_title || item.title,
                  quantity: item.quantity,
                  paid: itemPaid,
                  discount: parseFloat(item.total_discount),
                  productCost: productCost,
                  preTaxGrossProfit: preTaxGrossProfit,
                  preTaxGrossMargin: 66
                };
              })
            }
          }
        });
      }
    }

    // Update lastOrderSync time in the database to current time
    await prisma.store.update({
      where: { id: shopId },
      data: { lastOrderSync: currentTime },
    });

    res.status(200).send('Orders synchronized successfully');
  } catch (error) {
    console.error('Error syncing orders:', error);
    res.status(500).send('Internal Server Error');
  }
});



router.post('/sync-products', async (req: Request, res: Response) => {
  const { shopId } = req.body;

  if (!shopId) {
    return res.status(400).send('Missing required parameter: shopId');
  }

  try {
    // Fetch store information from the database using shopId
    const store = await prisma.store.findUnique({
      where: { id: shopId },
    });

    if (!store) {
      return res.status(404).send('Store not found');
    }

    // Initialize Shopify API client
    const shopify = new Shopify({
      shopName: store.shopifyName,
      accessToken: store.accessToken,
    });

    const currentTime = new Date();

    let hasMoreProducts = true;
    let params: any = { 
      limit: 250,
      updated_at_max: currentTime.toISOString()
    };

    while (hasMoreProducts) {
      const products = await shopify.product.list(params);

      if (products.length < params.limit) {
        hasMoreProducts = false;
      } else {
        const lastProduct = products[products.length - 1];
        params = { ...params, since_id: lastProduct.id };
      }

      // Sync products and variants to the database
      for (const product of products) {
        const createdProduct = await prisma.product.upsert({
          where: { productId: product.id.toString() },
          update: {
            title: product.title,
            storeId: shopId,
          },
          create: {
            productId: product.id.toString(),
            title: product.title,
            storeId: shopId,
          },
        });

        // Sync variants
        for (const variant of product.variants) {
          await prisma.variant.upsert({
            where: { variantId: variant.id.toString() },
            update: {
              title: variant.title,
              price: parseFloat(variant.price),
              inventoryQuantity: variant.inventory_quantity,
              productId: createdProduct.id,
            },
            create: {
              variantId: variant.id.toString(),
              title: variant.title,
              price: parseFloat(variant.price),
              inventoryQuantity: variant.inventory_quantity,
              productId: createdProduct.id,
            },
          });
        }
      }
    }

    await prisma.store.update({
      where: { id: shopId },
      data: { lastProductSync: currentTime },
    });

    res.status(200).send('Products synchronized successfully');
  } catch (error) {
    console.error('Error syncing products:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/resync-products', async (req: Request, res: Response) => {
  const { shopId } = req.body;

  if (!shopId) {
    return res.status(400).send('Missing required parameter: shopId');
  }

  try {
    // Fetch store information from the database using shopId
    const store = await prisma.store.findUnique({
      where: { id: shopId },
    });

    if (!store) {
      return res.status(404).send('Store not found');
    }

    const { shopifyName: shopName, accessToken, lastProductSync } = store;
    const shopify = new Shopify({
      shopName: shopName,
      accessToken: accessToken,
    });

    // Get the current time
    const currentTime = new Date();

    let hasMoreProducts = true;
    let params: any = {
      limit: 250,
      updated_at_min: lastProductSync.toISOString(),
      updated_at_max: currentTime.toISOString(),
    };

    while (hasMoreProducts) {
      const products = await shopify.product.list(params);

      if (products.length < params.limit) {
        hasMoreProducts = false;
      } else {
        const lastProduct = products[products.length - 1];
        params = { ...params, since_id: lastProduct.id };
      }

      for (const product of products) {
        const createdProduct = await prisma.product.upsert({
          where: { productId: product.id.toString() },
          update: {
            title: product.title,
            storeId: shopId,
          },
          create: {
            productId: product.id.toString(),
            title: product.title,
            storeId: shopId,
          },
        });

        for (const variant of product.variants) {
          await prisma.variant.upsert({
            where: { variantId: variant.id.toString() },
            update: {
              title: variant.title,
              price: parseFloat(variant.price),
              inventoryQuantity: variant.inventory_quantity,
              productId: createdProduct.id,
            },
            create: {
              variantId: variant.id.toString(),
              title: variant.title,
              price: parseFloat(variant.price),
              inventoryQuantity: variant.inventory_quantity,
              productId: createdProduct.id,
            },
          });
        }
      }
    }

    // Update lastProductSync time in the database to current time
    await prisma.store.update({
      where: { id: shopId },
      data: { lastProductSync: currentTime },
    });

    res.status(200).send('Products synchronized successfully');
  } catch (error) {
    console.error('Error syncing products:', error);
    res.status(500).send('Internal Server Error');
  }
})


interface ExportOrdersRequest {
  shopId: string;
}
  
interface ExportedOrder {
    date: string;
    orderId: number;
    customer: string;
    fulfillmentStatus: string;
    paid: number;
    shippingCost: number;
    discount: number;
    cogs: number;
    grossProfit: number;
    products: ExportedLineItem[];
}
  
interface ExportedLineItem {
    name: string;
    quantity: number;
    paid: number;
    discount: number;
    productCost: number;
    preTaxGrossProfit: number;
    preTaxGrossMargin: string;
}
  
router.post('/orders', async (req: Request, res: Response) => {
    const { shopId }: ExportOrdersRequest = req.body;
  
    if (!shopId) {
      return res.status(400).send('Missing required parameter: shopId');
    }
  
    try {
      const orders = await prisma.order.findMany({
        where: {
          storeId: shopId,
        },
        include: {
          lineItems: true,
        },
      });
  
      const exportedOrders: ExportedOrder[] = orders.map(order => {
        const products: ExportedLineItem[] = order.lineItems.map(item => ({
          name: item.name,
          quantity: item.quantity,
          paid: item.paid,
          discount: item.discount,
          productCost: parseFloat(item.productCost.toFixed(2)),
          preTaxGrossProfit: parseFloat(item.preTaxGrossProfit.toFixed(2)),
          preTaxGrossMargin: `${item.preTaxGrossMargin}%`,
        }));
  
        return {
          date: format(new Date(order.date), 'dd MMM yyyy'),
          orderId: parseInt(order.orderId, 10),
          customer: order.customer,
          fulfillmentStatus: order.fulfillmentStatus,
          paid: order.paid,
          shippingCost: order.shippingCost,
          discount: order.discount,
          cogs: parseFloat(order.cogs.toFixed(2)),
          grossProfit: parseFloat(order.grossProfit.toFixed(2)),
          products: products,
        };
      })
  
      res.status(200).json(exportedOrders);
    } catch (error) {
      console.error('Error exporting orders:', error);
      res.status(500).send('Internal Server Error');
    }
});

router.post('/products', async (req: Request, res: Response) => {
  const { shopId } = req.body;

  if (!shopId) {
    return res.status(400).send('Missing required parameter: shopId');
  }

  try {
    // Fetch products and variants from the database for the given shop
    const products = await prisma.product.findMany({
      where: { storeId: shopId },
      include: { variants: true },
    });

    // Fetch orders and lineItems from the database for the given shop
    const orders = await prisma.order.findMany({
      where: { storeId: shopId },
      include: { lineItems: true },
    });

    let totalStock = 0;
    let totalSales = 0;
    let totalRevenue = 0;
    let totalCogs = 0;
    let totalProductMargin = 0;

    const productData = products.map((product) => {
      const productVariants = product.variants;

      const stock = productVariants.reduce((total, variant) => total + variant.inventoryQuantity, 0);
      const prices = productVariants.map(variant => variant.price);
      const highPrice = Math.max(...prices);
      const lowPrice = Math.min(...prices);

      const sales = productVariants.reduce((total, variant) => {
        const variantSales = orders.reduce((sum, order) => {
          return sum + order.lineItems.filter(item => item.variantId === variant.variantId).reduce((itemSum, item) => itemSum + item.quantity, 0);
        }, 0);
        return total + variantSales;
      }, 0);

      const revenue = productVariants.reduce((total, variant) => {
        const variantRevenue = orders.reduce((sum, order) => {
          return sum + order.lineItems.filter(item => item.variantId === variant.variantId).reduce((itemSum, item) => itemSum + item.paid, 0);
        }, 0);
        return total + variantRevenue;
      }, 0);

      const productMargin = revenue * 0.66;
      const productCost = revenue - productMargin;
      const cogs = productCost; // Simplified assumption: COGS is equivalent to product cost

      totalStock += stock;
      totalSales += sales;
      totalRevenue += revenue;
      totalCogs += cogs;
      totalProductMargin += productMargin;

      const variants = productVariants.map((variant) => {
        const variantSales = orders.reduce((sum, order) => {
          return sum + order.lineItems.filter(item => item.variantId === variant.variantId).reduce((itemSum, item) => itemSum + item.quantity, 0);
        }, 0);

        const variantRevenue = orders.reduce((sum, order) => {
          return sum + order.lineItems.filter(item => item.variantId === variant.variantId).reduce((itemSum, item) => itemSum + item.paid, 0);
        }, 0);

        const variantProductMargin = variantRevenue * 0.66;
        const variantProductCost = variantRevenue - variantProductMargin;
        const variantCogs = variantProductCost; // Simplified assumption: COGS is equivalent to product cost

        return {
          name: variant.title,
          stock: variant.inventoryQuantity,
          price: variant.price,
          sales: variantSales,
          productCost: variantProductCost,
          packagingFee: 0.00,
          transactionFee: 0.00,
          cogs: variantCogs,
          fulfillmentCost: 0.00,
          bepRoas: 1.71,
          revenue: variantRevenue,
          productMargin: variantProductMargin,
          productMarginPercent: 66,
        };
      });

      return {
        name: product.title,
        stock,
        price: {
          high: highPrice,
          low: lowPrice,
        },
        sales,
        productCost: {
          high: highPrice,
          low: lowPrice,
        },
        packagingFee: 0.00,
        transactionFee: 0.00,
        cogs: {
          high: highPrice,
          low: lowPrice,
        },
        fulfillmentCost: 0.00,
        bepRoas: 1.71,
        revenue,
        productMargin,
        productMarginPercent: 66,
        variants,
      };
    });

    const summary = {
      stock: totalStock,
      price: {
        high: Math.max(...products.map(p => Math.max(...p.variants.map(v => v.price)))),
        low: Math.min(...products.map(p => Math.min(...p.variants.map(v => v.price)))),
      },
      sales: totalSales,
      productCost: {
        high: Math.max(...products.map(p => Math.max(...p.variants.map(v => v.price)))),
        low: Math.min(...products.map(p => Math.min(...p.variants.map(v => v.price)))),
      },
      packagingFee: 0.00,
      transactionFee: 0.00,
      cogs: {
        high: Math.max(...products.map(p => Math.max(...p.variants.map(v => v.price * 0.34)))),
        low: Math.min(...products.map(p => Math.min(...p.variants.map(v => v.price * 0.34)))),
      },
      fulfillmentCost: 0.00,
      bepRoas: 1.71,
      revenue: totalRevenue,
      productMargin: totalProductMargin,
      productMarginPercent: 66,
    };

    res.status(200).json({ productData, summary });
  } catch (error) {
    console.error('Error exporting product data:', error);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/metrics', async(req: Request, res: Response) => {
  const { shopId } = req.body;
  if (!shopId) {
    return res.status(400).send('Missing required parameter: shopId');
  }

  try {
    const orders = await prisma.order.findMany({
      where: { storeId: shopId },
      include: { lineItems: true },
    })

    const timePeriod = getDatesInMonth(2024 , 5)
    const labels = timePeriod.map( (date) => format(date, "dd MM"))

    const totalSalesValues = timePeriod.map( (date) => {
      let totalSales = 0
      orders.forEach((order) => {
          const orderDate = new Date(order.date).toDateString()
          if(date.toDateString() === orderDate) {
              totalSales += order.paid
          }
      })
      return totalSales
    })

    const taxesValues = timePeriod.map( (date) => {
      let totalSales = 0
      orders.forEach((order) => {
          const orderDate = new Date(order.date).toDateString()
          if(date.toDateString() === orderDate) {
              totalSales += order.tax
          }
      })
      return totalSales
    })

    const netSalesValues = totalSalesValues.map( (v,i) => v - taxesValues[i])
    
    const cogsValues = timePeriod.map( (date) => {
      let totalSales = 0
      orders.forEach((order) => {
          const orderDate = new Date(order.date).toDateString()
          if(date.toDateString() === orderDate) {
              totalSales += order.cogs
          }
      })
      return totalSales
    })

    const cogsMarginValues = cogsValues.map( (v,i) => { return (v/netSalesValues[i])*100 ? (v/netSalesValues[i])*100 : 0 })

    const grossProfitValues = netSalesValues.map( (v,i) => v - cogsValues[i])

    const grossProfitMarginValues = grossProfitValues.map( (v,i) => { return (v/netSalesValues[i])*100 ? (v/netSalesValues[i])*100 : 0})

    const ordersValues = timePeriod.map( (date) => {
      let number = 0
      orders.forEach((order) => {
          const orderDate = new Date(order.date).toDateString()
          if(date.toDateString() === orderDate) {
              number ++
          }
      })
      return number
    })

    const firstOrderDates:any = {};
    orders.forEach((order) => {
      const orderDate = new Date(order.date).toDateString();
      const customerId = order.customerId;
      if (customerId && (!firstOrderDates[customerId] || new Date(firstOrderDates[customerId]) > new Date(orderDate))) {
        firstOrderDates[customerId] = orderDate;
      }
    })

    // Calculate new customers per day
    const newCustomerCountvalues = timePeriod.map((date) => {
      const dateStr = date.toDateString();
      let newCustomerCount = 0;
      for (const firstOrderDate of Object.values(firstOrderDates)) {
        if (firstOrderDate === dateStr) {
          newCustomerCount++;
        }
      }
      return newCustomerCount;
    })

    const orderCounts:any = {};
    orders.forEach((order) => {
      const orderDate = new Date(order.date).toDateString();
      const customerId = order.customerId;
      if (customerId) {
        if (!orderCounts[customerId]) {
          orderCounts[customerId] = [];
        }
        orderCounts[customerId].push(orderDate);
      }
    });

    // Calculate repeat customers per day
    const repeatCustomerCountValues = timePeriod.map((date) => {
      const dateStr = date.toDateString();
      let repeatCustomerCount = 0;
      for (const dates of Object.values(orderCounts)) {
        //@ts-ignore
        if (dates.length > 1 && dates.includes(dateStr) && dates[0] !== dateStr) {
          repeatCustomerCount++;
        }
      }
      return repeatCustomerCount;
    })

    let totalAov = 0
    let aovNums = 0
    const aovValues = timePeriod.map( (date) => {
      let totalSales = 0
      let numberOfOrders = 0
      orders.forEach((order) => {
          const orderDate = new Date(order.date).toDateString()
          if(date.toDateString() === orderDate) {
              totalSales += order.paid
              numberOfOrders++
          }
      })
      if(numberOfOrders) {
        totalAov += totalSales/numberOfOrders
        aovNums++
      }
      return totalSales/numberOfOrders || 0
    })

    let totalAnoi = 0
    let anoiNums = 0
    const anoiValues = timePeriod.map( (date) => {
      let numberOfItems = 0
      let numberOfOrders = 0
      orders.forEach((order) => {
          const orderDate = new Date(order.date).toDateString()
          if(date.toDateString() === orderDate) {
              numberOfItems += order.lineItems.reduce( (a, i) => a + i.quantity, 0)
              numberOfOrders++
          }
      })
      if(numberOfOrders) {
        totalAnoi += numberOfItems/numberOfOrders
        anoiNums++
      }
      return numberOfItems/numberOfOrders || 0
    })

    const metrics = [
      {
        name: "Total Sales",
        description: "Equates to gross sales - discounts - returns + taxes + shipping charges.",
        values: totalSalesValues,
        total: `₹ ${totalSalesValues.reduce((s, c) => s + c, 0).toFixed(2)}`
      },
      {
        name: "Taxes", 
        description: "The total amount of taxes charged on orders during this period.",
        values: taxesValues,
        total: `₹ ${taxesValues.reduce((s, c) => s + c, 0).toFixed(2)}`
      },
      {
        name: "Net Sales", 
        description: "Equates to gross sales + shipping - taxes - discounts - returns.",
        values: netSalesValues,
        total: `₹ ${netSalesValues.reduce((s, c) => s + c, 0).toFixed(2)}`
      },
      {
        name: "COGS", 
        description: "Equates to Product Costs + Shipping Costs + Fulfillment Costs + Packing Fees + Transaction Fees",
        values: cogsValues,
        total: `₹ ${cogsValues.reduce((s, c) => s + c, 0).toFixed(2)}`
      },
      {
        name: "COGS %", 
        description: "Cost of Goods (COGS) as % of Net Sales",
        values: cogsMarginValues,
        total: `34%`
      },
      {
        name: "Gross Profit", 
        description: "Calculated by subtracting Cost of Goods (COGS) from Net Sales.",
        values: grossProfitValues,
        total: `₹ ${grossProfitValues.reduce((s, c) => s + c, 0).toFixed(2)}`
      },
      {
        name: "Gross Profit %", 
        description: "Gross Profit as a % of Net Sales",
        values: grossProfitMarginValues,
        total: '66%'
      },
      {
        name: "Orders", 
        description: "Number of orders",
        values: ordersValues,
        total: `${ordersValues.reduce((s, c) => s + c, 0)}`
      },
      {
        name: "New Customers", 
        description: "The number of first-time buyers during a specific period.",
        values: newCustomerCountvalues,
        total: `${newCustomerCountvalues.reduce((s, c) => s + c, 0)}`
      },
      {
        name: "Repeat Customers", 
        description: "Customers who have made more than one purchase in their order history.",
        values: repeatCustomerCountValues,
        total: `${repeatCustomerCountValues.reduce((s, c) => s + c, 0)}`
      },
      {
        name: "AOV", 
        description: "Average Value of Each Order Total Sales / Orders",
        values: aovValues,
        total: `${(totalAov/aovNums).toFixed(2)}`
      },
      {
        name: "Average No Of Items", 
        description: "The average number of items per order. | Total Items Ordered / Total Orders.",
        values: anoiValues,
        total: `${totalAnoi/anoiNums}`
      }

    ]

    res.status(200).json({
      metrics,
      labels
    })
  
  } catch (e) {
    console.error('Error exporting metric data:', e);
    res.status(500).send('Internal Server Error');
  }

})
  

export default router;