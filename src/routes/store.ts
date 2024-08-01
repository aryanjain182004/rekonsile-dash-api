import { Router } from 'express';
import { Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { PrismaClient } from '@prisma/client';
import Shopify, { IOrder as ShopifyOrder } from 'shopify-api-node';
import { eachDayOfInterval, format, subYears } from 'date-fns';
import { getDatesInMonth } from '../utils/date';
import { resyncStoreData, syncStoreData } from '../controllers/syncController';

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
                currency: "₹ INR",
                storeUrl: "http://yourstore.com/",
                industry: "Other",
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

router.post('/update-access-token', authMiddleware, async(req: any,res: Response) => {
  const { shopifyName, accessToken, storeId} = req.body

  try {
    await prisma.store.update({
      data: {
        accessToken,
        shopifyName
      },
      where: {
        id: storeId
      }
    })

    res.status(201).json({
      message: `store access token updated successfully`,
    })
  } catch(e) {
    console.error(e)
    res.status(500).json({
      error: "Failed to update store access token"
    })
  }
})

router.post('/update-general', authMiddleware, async(req: any,res: Response) => {
  const { name, storeUrl, industry, storeId} = req.body

  try {
    await prisma.store.update({
      data: {
        name,
        storeUrl,
        industry,
      },
      where: {
        id: storeId
      }
    })

    res.status(201).json({
      message: `general settings updated successfully`,
    })
  } catch(e) {
    console.error(e)
    res.status(401).json({
      error: "Failed to update general settings"
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
                accessToken: true,
                shopifyName: true,
                lastSync: true,
                syncing: true,
                storeUrl: true,
                currency: true,
                industry: true,
            }
        })

        const resStores = stores.map( s => {
          let synced;
          if( (s.shopifyName === "" || s.accessToken === "") || (!s.shopifyName || !s.accessToken )) {
            synced = false
          } else {
            synced = true
          }
          const { accessToken, shopifyName , ...newStore} = s
          return {...newStore, synced}
        })
        res.status(200).json({
            stores: resStores
        })
    } catch(e) {
        console.error(e)
        res.status(500).json({
            error: "Failed to fetch stores"
        })
    }
})

router.post('/synced-check', authMiddleware, async(req: any, res: Response) => {
  const {storeId} = req.body;

  try {
    const store = await prisma.store.findUnique({
        where: {
            id: storeId,
        },
        select: {
          shopifyName: true,
          accessToken: true,
        }
    })

    //@ts-ignore
    const {shopifyName, accessToken} = store
    let synced;

    if(shopifyName === "" || accessToken == "") {
      synced = false
    } else {
      synced = true
    }
    
    res.status(200).json({
      synced,
    })

  } catch(e) {
    console.error(e)
    res.status(500).json({
      error: "Failed to check store sync data"
    })
  }
}) 

router.post('/sync-store', authMiddleware, async(req: any, res: Response) => {
  const {storeId} = req.body;

  try {

    await prisma.store.update({
      data: {
        syncing: true
      },
      where: {
        id: storeId
      }
    })

    syncStoreData(storeId, prisma)

    res.status(200).json({
      message: "store data is syncing"
    })

  } catch(e) {
    console.error(e)
    res.status(500).json({
      error: "Failed to sync store data"
    })
  }
})

router.post('/resync-store', authMiddleware, async(req: any, res: Response) => {
  const {storeId} = req.body;

  try {
    const currentTime = new Date()

    await prisma.store.update({
      data: {
        syncing: true
      },
      where: {
        id: storeId
      }
    })

    resyncStoreData(storeId, prisma, currentTime)

    res.status(200).json({
      message: "store data is syncing",
      syncTime: currentTime
    })

  } catch(e) {
    console.error(e)
    res.status(500).json({
      error: "Failed to sync store data"
    })
  }
})

router.post('/disconnect-shopify', authMiddleware, async(req: any, res: Response) => {
  const {storeId} = req.body;

  try {

    await prisma.store.update({
      where: {
        id: storeId
      },
      data: {
        shopifyName: "",
        accessToken: "",
      }
    })

    await prisma.metric.deleteMany({
      where: {
        shopId: storeId
      },
    })

    await prisma.$transaction(async(prisma) => {

      await prisma.lineItem.deleteMany({
        where: {
          order: {
            storeId: storeId,
          },
        },
      });

      await prisma.order.deleteMany({
        where: {
          storeId: storeId,
        },
      });
    });

    await prisma.$transaction(async(prisma) => {

      await prisma.variant.deleteMany({
        where: {
          product: {
            storeId: storeId,
          },
        },
      });

      await prisma.product.deleteMany({
        where: {
          storeId: storeId,
        },
      });
    });

    res.status(200).json({
      message: "Disconnected from shopify successfully",
    })

  } catch(e) {
    console.error(e)
    res.status(500).json({
      error: "Failed to disconnect from shopify"
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

export const fetchAndProcessOrders = async (shopify: Shopify, shopId: string, currentTime: Date): Promise<void> => {
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
            orderId: order.order_number.toString(),
            source: order.source_name,
            customer: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Unknown',
            customerId: order.customer?.id.toString() || "",
            fulfillmentStatus: order.fulfillment_status ? order.fulfillment_status : "Unfulfilled",
            paid: paid,
            tax: tax,
            shippingCost: 0,
            //@ts-ignore
            shippingPaid: parseFloat(order.total_shipping_price_set.shop_money.amount),
            shippingCountry: order.shipping_address?.country || "N/A",
            shippingRegion: order.shipping_address?.province_code || "N/A",
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
      data: { lastSync: currentTime },
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

    const { shopifyName: shopName, accessToken, lastSync } = store;
    const shopify = new Shopify({
      shopName: shopName,
      accessToken: accessToken,
    });

    // Get the current time
    const currentTime = new Date();

    let hasMoreOrders = true;
    let params: any = {
      limit: 250,
      created_at_min: lastSync.toISOString(),
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
            orderId: order.order_number.toString(),
            source: order.source_name,
            customer: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Unknown',
            customerId: order.customer?.id.toString() || "",
            fulfillmentStatus: order.fulfillment_status ? order.fulfillment_status : "Unfulfilled",
            paid: paid,
            tax: tax,
            shippingCost: 0,
            //@ts-ignore
            shippingPaid: parseFloat(order.total_shipping_price_set.shop_money.amount),
            shippingCountry: order.shipping_address?.country || "N/A",
            shippingRegion: order.shipping_address?.province_code || "N/A",
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

    // Update lastSync time in the database to current time
    await prisma.store.update({
      where: { id: shopId },
      data: { lastSync: currentTime },
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
      updated_at_max: store.lastSync.toISOString()
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

    const { shopifyName: shopName, accessToken, lastSync } = store;
    const shopify = new Shopify({
      shopName: shopName,
      accessToken: accessToken,
    });

    // Get the current time
    const currentTime = new Date();

    let hasMoreProducts = true;
    let params: any = {
      limit: 250,
      updated_at_min: lastSync.toISOString(),
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
  
router.post('/fetch-orders', async (req: Request, res: Response) => {
  const { shopId, startDate, endDate } = req.body;

  if (!shopId || !startDate || !endDate) {
    return res.status(400).send('Missing required parameters: shopId, startDate, or endDate');
  }
  
    try {

      const start = new Date(startDate)
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      const orders = await prisma.order.findMany({
        where: {
          storeId: shopId,
          date: {
            gte: start,
            lte: end,
          }
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
          source: order.source,
          fulfillmentStatus: order.fulfillmentStatus,
          paid: order.paid,
          shippingCost: order.shippingCost,
          shippingPaid: order.shippingPaid,
          shippingCountry: order.shippingCountry,
          shippingRegion: order.shippingRegion,
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

router.post('/fetch-products', async (req: Request, res: Response) => {
  const { shopId, startDate, endDate } = req.body;

  if (!shopId || !startDate || !endDate) {
    return res.status(400).send('Missing required parameters: shopId, startDate, or endDate');
  }

  try {
    const products = await prisma.product.findMany({
      where: { 
        storeId: shopId
      },
      include: { variants: true },
    });

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    const orders = await prisma.order.findMany({
      where: { 
        storeId: shopId,
        date: {
          gte: start,
          lte: end,
        }
      },
      include: { lineItems: true },
    });

    let totalStock = 0;
    let totalSales = 0;
    let totalRevenue = 0;
    let totalCogs = 0;
    let totalProductMargin = 0;

    const productData = products.reduce((acc, product) => {
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

      if (sales === 0) {
        return acc; // Skip products with no sales
      }

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
          productCost: parseFloat(variantProductCost.toFixed(2)),
          packagingFee: 0.00,
          transactionFee: 0.00,
          cogs: parseFloat(variantCogs.toFixed(2)),
          fulfillmentCost: 0.00,
          bepRoas: 1.71,
          revenue: variantRevenue,
          productMargin: parseFloat(variantProductMargin.toFixed(2)),
          productMarginPercent: 66,
        };
      });

      //@ts-ignore
      acc.push({
        name: product.title,
        stock,
        price: {
          high: highPrice,
          low: lowPrice,
        },
        sales,
        productCost: {
          high: Math.max(...variants.map(v => parseFloat(v.productCost.toFixed(2)))),
          low: Math.min(...variants.map(v => parseFloat(v.productCost.toFixed(2)))),
        },
        packagingFee: 0.00,
        transactionFee: 0.00,
        cogs: {
          high: Math.max(...variants.map(v => parseFloat(v.cogs.toFixed(2)))),
          low: Math.min(...variants.map(v => parseFloat(v.cogs.toFixed(2)))),
        },
        fulfillmentCost: 0.00,
        bepRoas: 1.71,
        revenue,
        productMargin: parseFloat(productMargin.toFixed(2)),
        productMarginPercent: 66,
        variants,
      });

      return acc;
    }, []);

    const summary = {
      stock: totalStock,
      price: {
        //@ts-ignore
        high: Math.max(...productData.map(p => p.price.high)),
        //@ts-ignore
        low: Math.min(...productData.map(p => p.price.low)),
      },
      sales: totalSales,
      productCost: {
        //@ts-ignore
        high: Math.max(...productData.map(p => parseFloat(p.productCost.high.toFixed(2)))),
        //@ts-ignore
        low: Math.min(...productData.map(p => parseFloat(p.productCost.low.toFixed(2)))),
      },
      packagingFee: 0.00,
      transactionFee: 0.00,
      cogs: {
        //@ts-ignore
        high: Math.max(...productData.map(p => parseFloat(p.cogs.high.toFixed(2)))),
        //@ts-ignore
        low: Math.min(...productData.map(p => parseFloat(p.cogs.low.toFixed(2)))),
      },
      fulfillmentCost: 0.00,
      bepRoas: 1.71,
      revenue: parseFloat(totalRevenue.toFixed(2)),
      productMargin: parseFloat(totalProductMargin.toFixed(2)),
      productMarginPercent: 66,
    };

    res.status(200).json({ productData, summary });
  } catch (error) {
    console.error('Error exporting product data:', error);
    res.status(500).send('Internal Server Error');
  }
});



export const getDatesInInterval = (startDate: Date, endDate: Date) => {
  return eachDayOfInterval({ start: startDate, end: endDate });
}

router.post('/sync-metrics', async (req: Request, res: Response) => {
  const { shopId } = req.body;
  if (!shopId) {
    return res.status(400).send('Missing required parameter: shopId');
  }

  try {
    const orders = await prisma.order.findMany({
      where: { storeId: shopId },
      include: { lineItems: true },
    });

    const endDate = new Date();
    const startDate = subYears(endDate, 5);
    const timePeriod = getDatesInInterval(startDate, endDate);

    const totalSalesValues = timePeriod.map((date) => {
      let totalSales = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate) {
          totalSales += order.paid;
        }
      });
      return totalSales;
    });

    const taxesValues = timePeriod.map((date) => {
      let totalSales = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate) {
          totalSales += order.tax || 0;
        }
      });
      return totalSales;
    });

    const netSalesValues = totalSalesValues.map((v, i) => v - taxesValues[i]);

    const cogsValues = timePeriod.map((date) => {
      let totalSales = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate) {
          totalSales += order.cogs;
        }
      });
      return totalSales;
    });

    const grossProfitValues = netSalesValues.map((v, i) => v - cogsValues[i]);

    const grossProfitMarginValues = grossProfitValues.map((v, i) =>
      netSalesValues[i] ? (v / netSalesValues[i]) * 100 : 0
    );

    const cogsMarginValues = cogsValues.map((v, i) => (netSalesValues[i] ? (v / netSalesValues[i]) * 100 : 0));

    const ordersValues = timePeriod.map((date) => {
      let number = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate) {
          number++;
        }
      });
      return number;
    });

    // Fetch existing customer order histories
    const existingCustomers = await prisma.customerOrderHistory.findMany({
      where: { shopId },
    });

    const customerOrderHistory = existingCustomers.reduce((acc, customer) => {
      acc[customer.customerId] = customer.orderDates;
      return acc;
    }, {} as { [key: string]: Date[] });

    // Update customer order histories
    for (const order of orders) {
      const { customerId, date } = order;
      if (customerId) {
        if (!customerOrderHistory[customerId]) {
          customerOrderHistory[customerId] = [];
        }
        customerOrderHistory[customerId].push(date);
      }
    }

    // Save updated customer order histories
    for (const [customerId, orderDates] of Object.entries(customerOrderHistory)) {
      await prisma.customerOrderHistory.upsert({
        where: {
          customerId_shopId: { customerId, shopId },
        },
        update: {
          orderDates,
        },
        create: {
          customerId,
          shopId,
          orderDates,
        },
      });
    }

    const firstOrderDates: any = {};
    orders.forEach((order) => {
      const orderDate = order.date.toISOString().split('T')[0];
      const customerId = order.customerId;
      if (customerId && (!firstOrderDates[customerId] || new Date(firstOrderDates[customerId]) > new Date(orderDate))) {
        firstOrderDates[customerId] = orderDate;
      }
    });

    const newCustomerCountValues = timePeriod.map((date) => {
      const dateStr = date.toISOString().split('T')[0];
      let newCustomerCount = 0;
      for (const firstOrderDate of Object.values(firstOrderDates)) {
        if (firstOrderDate === dateStr) {
          newCustomerCount++;
        }
      }
      return newCustomerCount;
    });

    const repeatCustomerCountValues = timePeriod.map((date) => {
      const dateStr = date.toISOString().split('T')[0];
      let repeatCustomerCount = 0;
      for (const [customerId, orderDates] of Object.entries(customerOrderHistory)) {
        if (orderDates.length > 1 && orderDates.some((d) => d.toISOString().split('T')[0] === dateStr)) {
          repeatCustomerCount++;
        }
      }
      return repeatCustomerCount;
    });

    let totalAov = 0;
    let aovNums = 0;
    const aovValues = timePeriod.map((date) => {
      let totalSales = 0;
      let numberOfOrders = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate) {
          totalSales += order.paid;
          numberOfOrders++;
        }
      });
      if (numberOfOrders) {
        totalAov += totalSales / numberOfOrders;
        aovNums++;
      }
      return totalSales / numberOfOrders || 0;
    });

    let totalAnoi = 0;
    let anoiNums = 0;
    const anoiValues = timePeriod.map((date) => {
      let numberOfItems = 0;
      let numberOfOrders = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate) {
          numberOfItems += order.lineItems.reduce((a, i) => a + i.quantity, 0);
          numberOfOrders++;
        }
      });
      if (numberOfOrders) {
        totalAnoi += numberOfItems / numberOfOrders;
        anoiNums++;
      }
      return numberOfItems / numberOfOrders || 0;
    });

    const newCustomers = {}; // Store new customer IDs and their first order date
    orders.forEach(order => {
      //@ts-ignore
      if (!newCustomers[order.customerId]) {
        //@ts-ignore
        newCustomers[order.customerId] = order.date;
      }
    });

    const newCustomerSalesValues = timePeriod.map(date => {
      let totalSales = 0;
      orders.forEach(order => {
        const orderDate = order.date.toISOString().split('T')[0];
        //@ts-ignore
        if (date.toISOString().split('T')[0] === orderDate && newCustomers[order.customerId] === order.date) {
          totalSales += (order.paid - order.tax);
        }
      });
      return totalSales;
    });

    const newCustomerAovValues = timePeriod.map(date => {
      let totalSales = 0;
      let numberOfOrders = 0;
      orders.forEach(order => {
        const orderDate = order.date.toISOString().split('T')[0];
        //@ts-ignore
        if (date.toISOString().split('T')[0] === orderDate && newCustomers[order.customerId] === order.date) {
          totalSales += order.paid;
          numberOfOrders++;
        }
      });
      return totalSales / numberOfOrders || 0;
    });

    const repeatCustomers = Object.keys(customerOrderHistory).filter(customerId => customerOrderHistory[customerId].length > 1);

    const repeatCustomerSalesValues = timePeriod.map(date => {
      let totalSales = 0;
      orders.forEach(order => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate && repeatCustomers.includes(order.customerId)) {
          totalSales += order.paid - order.tax;
        }
      });
      return totalSales;
    });

    const repeatCustomerAovValues = timePeriod.map(date => {
      let totalSales = 0;
      let numberOfOrders = 0;
      orders.forEach(order => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate && repeatCustomers.includes(order.customerId)) {
          totalSales += order.paid;
          numberOfOrders++;
        }
      });
      return totalSales / numberOfOrders || 0;
    });

    const newCustomerOrderCountValues = timePeriod.map((date) => {
      const dateStr = date.toISOString().split('T')[0];
      let newCustomerOrderCount = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        //@ts-ignore
        if (orderDate === dateStr && newCustomers[order.customerId] === order.date) {
          newCustomerOrderCount++;
        }
      });
      return newCustomerOrderCount;
    });

    const totalCustomerValues = timePeriod.map((date) => {
      const uniqueCustomers = new Set();
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0]
          if (date.toISOString().split('T')[0] === orderDate) {
              uniqueCustomers.add(order.customerId); // Add customer ID to the set
          }
      });
      return uniqueCustomers.size; // Return the number of unique customers
    });

    const metricsData = [
      {
        name: 'Total Sales',
        description: 'Equates to gross sales - discounts - returns + taxes + shipping charges.',
        values: totalSalesValues,
      },
      {
        name: 'Taxes',
        description: 'The total amount of taxes charged on orders during this period.',
        values: taxesValues,
      },
      {
        name: 'Net Sales',
        description: 'Equates to gross sales + shipping - taxes - discounts - returns.',
        values: netSalesValues,
      },
      {
        name: 'COGS',
        description: 'Equates to Product Costs + Shipping Costs + Fulfillment Costs + Packing Fees + Transaction Fees',
        values: cogsValues,
      },
      {
        name: 'Gross Profit',
        description: 'Calculated by subtracting Cost of Goods (COGS) from Net Sales.',
        values: grossProfitValues,
      },
      {
        name: 'Gross Profit %',
        description: 'Gross Profit as a % of Net Sales',
        values: grossProfitMarginValues,
      },
      {
        name: 'COGS %',
        description: 'Cost of Goods (COGS) as % of Net Sales',
        values: cogsMarginValues,
      },
      {
        name: 'Orders',
        description: 'Number of orders',
        values: ordersValues,
      },
      {
        name: 'New Customer Orders',
        description: 'Number of orders from new customers',
        values: newCustomerOrderCountValues
      },
      {
        name: 'New Customers',
        description: 'The number of first-time buyers during a specific period.',
        values: newCustomerCountValues,
      },
      {
        name: 'Repeat Customers',
        description: 'Customers who have made more than one purchase in their order history.',
        values: repeatCustomerCountValues,
      },
      {
        name: 'New Customer Sales',
        description: 'Net Sales generated from new customers during this time period.',
        values: newCustomerSalesValues
      },
      {
        name: "Repeat Customer Sales", 
        description: "Net Sales generated from existing customers during this time period.",
        values: repeatCustomerSalesValues
      },
      {
        name: "New Customer AOV", 
        description: "Average Value of Each Order from a New Customer. Total New Customer Sales / Number of New Customers.",
        values: newCustomerAovValues
      },
      {
        name: "Repeat Customer AOV", 
        description: "Average Value of Each Order from a Repeat Customer. Total Repeat Customer Sales / Number of Repeat Customers.",
        values: repeatCustomerAovValues
      },
      {
        name: 'AOV',
        description: 'Average Value of Each Order Total Sales / Orders',
        values: aovValues,
      },
      {
        name: 'Average No Of Items',
        description: 'The average number of items per order. | Total Items Ordered / Total Orders.',
        values: anoiValues,
      },
      {
        name: "Total Customers", 
        description: "The total number of unique customers who have made a purchase.",
        values: totalCustomerValues
      }
    ];

    for (const metric of metricsData) {
      for (let i = 0; i < timePeriod.length; i++) {
        if(metric.values[i]){
          await prisma.metric.upsert({
            where: {
              shopId_date_metricType: {
                shopId,
                date: timePeriod[i],
                metricType: metric.name,
              },
            },
            update: {
              value: metric.values[i],
              description: metric.description,
            },
            create: {
              shopId,
              date: timePeriod[i],
              metricType: metric.name,
              value: metric.values[i],
              description: metric.description,
            },
          });
        }
      }
    }

    res.status(200).json({
      message: "metrics synced successfully"
    });
  } catch (e) {
    console.error('Error exporting metric data:', e);
    res.status(500).send('Internal Server Error');
  }
})

router.post('/resync-metrics', async (req: Request, res: Response) => {
  const { shopId } = req.body;
  if (!shopId) {
    return res.status(400).send('Missing required parameter: shopId');
  }

  try {

    const store = await prisma.store.findUnique({
      where: { id: shopId },
    });

    if (!store) {
      return res.status(404).send('Store not found');
    }

    const { lastSync } = store;

    const orders = await prisma.order.findMany({
      where: {
        storeId: shopId,
        date: {
          gte: lastSync,
        },
      },
      include: { lineItems: true },
    });

    const endDate = new Date();
    const timePeriod = getDatesInInterval(lastSync, endDate);

    const totalSalesValues = timePeriod.map((date) => {
      let totalSales = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate) {
          totalSales += order.paid;
        }
      });
      return totalSales;
    });

    const taxesValues = timePeriod.map((date) => {
      let totalSales = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate) {
          totalSales += order.tax || 0;
        }
      });
      return totalSales;
    });

    const netSalesValues = totalSalesValues.map((v, i) => v - taxesValues[i]);

    const cogsValues = timePeriod.map((date) => {
      let totalSales = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate) {
          totalSales += order.cogs;
        }
      });
      return totalSales;
    });

    const grossProfitValues = netSalesValues.map((v, i) => v - cogsValues[i]);

    const grossProfitMarginValues = grossProfitValues.map((v, i) =>
      netSalesValues[i] ? (v / netSalesValues[i]) * 100 : 0
    );

    const cogsMarginValues = cogsValues.map((v, i) => (netSalesValues[i] ? (v / netSalesValues[i]) * 100 : 0));

    const ordersValues = timePeriod.map((date) => {
      let number = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate) {
          number++;
        }
      });
      return number;
    });

    // Fetch existing customer order histories
    const existingCustomers = await prisma.customerOrderHistory.findMany({
      where: { shopId },
    });

    const customerOrderHistory = existingCustomers.reduce((acc, customer) => {
      acc[customer.customerId] = customer.orderDates;
      return acc;
    }, {} as { [key: string]: Date[] });

    // Update customer order histories
    for (const order of orders) {
      const { customerId, date } = order;
      if (customerId) {
        if (!customerOrderHistory[customerId]) {
          customerOrderHistory[customerId] = [];
        }
        customerOrderHistory[customerId].push(date);
      }
    }

    // Save updated customer order histories
    for (const [customerId, orderDates] of Object.entries(customerOrderHistory)) {
      await prisma.customerOrderHistory.upsert({
        where: {
          customerId_shopId: { customerId, shopId },
        },
        update: {
          orderDates,
        },
        create: {
          customerId,
          shopId,
          orderDates,
        },
      });
    }

    const firstOrderDates: any = {};
    orders.forEach((order) => {
      const orderDate = order.date.toISOString().split('T')[0];
      const customerId = order.customerId;
      if (customerId && (!firstOrderDates[customerId] || new Date(firstOrderDates[customerId]) > new Date(orderDate))) {
        firstOrderDates[customerId] = orderDate;
      }
    });

    const newCustomerCountValues = timePeriod.map((date) => {
      const dateStr = date.toISOString().split('T')[0];
      let newCustomerCount = 0;
      for (const firstOrderDate of Object.values(firstOrderDates)) {
        if (firstOrderDate === dateStr) {
          newCustomerCount++;
        }
      }
      return newCustomerCount;
    });

    const repeatCustomerCountValues = timePeriod.map((date) => {
      const dateStr = date.toISOString().split('T')[0];
      let repeatCustomerCount = 0;
      for (const [customerId, orderDates] of Object.entries(customerOrderHistory)) {
        if (orderDates.length > 1 && orderDates.some((d) => d.toISOString().split('T')[0] === dateStr)) {
          repeatCustomerCount++;
        }
      }
      return repeatCustomerCount;
    });

    let totalAov = 0;
    let aovNums = 0;
    const aovValues = timePeriod.map((date) => {
      let totalSales = 0;
      let numberOfOrders = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate) {
          totalSales += order.paid;
          numberOfOrders++;
        }
      });
      if (numberOfOrders) {
        totalAov += totalSales / numberOfOrders;
        aovNums++;
      }
      return totalSales / numberOfOrders || 0;
    });

    let totalAnoi = 0;
    let anoiNums = 0;
    const anoiValues = timePeriod.map((date) => {
      let numberOfItems = 0;
      let numberOfOrders = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate) {
          numberOfItems += order.lineItems.reduce((a, i) => a + i.quantity, 0);
          numberOfOrders++;
        }
      });
      if (numberOfOrders) {
        totalAnoi += numberOfItems / numberOfOrders;
        anoiNums++;
      }
      return numberOfItems / numberOfOrders || 0;
    });

    const newCustomers = {}; // Store new customer IDs and their first order date
    orders.forEach(order => {
      //@ts-ignore
      if (!newCustomers[order.customerId]) {
        //@ts-ignore
        newCustomers[order.customerId] = order.date;
      }
    });

    const newCustomerSalesValues = timePeriod.map(date => {
      let totalSales = 0;
      orders.forEach(order => {
        const orderDate = order.date.toISOString().split('T')[0];
        //@ts-ignore
        if (date.toISOString().split('T')[0] === orderDate && newCustomers[order.customerId] === order.date) {
          totalSales += (order.paid - order.tax);
        }
      });
      return totalSales;
    });

    const newCustomerAovValues = timePeriod.map(date => {
      let totalSales = 0;
      let numberOfOrders = 0;
      orders.forEach(order => {
        const orderDate = order.date.toISOString().split('T')[0];
        //@ts-ignore
        if (date.toISOString().split('T')[0] === orderDate && newCustomers[order.customerId] === order.date) {
          totalSales += order.paid;
          numberOfOrders++;
        }
      });
      return totalSales / numberOfOrders || 0;
    });

    const repeatCustomers = Object.keys(customerOrderHistory).filter(customerId => customerOrderHistory[customerId].length > 1);

    const repeatCustomerSalesValues = timePeriod.map(date => {
      let totalSales = 0;
      orders.forEach(order => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate && repeatCustomers.includes(order.customerId)) {
          totalSales += order.paid - order.tax;
        }
      });
      return totalSales;
    });

    const repeatCustomerAovValues = timePeriod.map(date => {
      let totalSales = 0;
      let numberOfOrders = 0;
      orders.forEach(order => {
        const orderDate = order.date.toISOString().split('T')[0];
        if (date.toISOString().split('T')[0] === orderDate && repeatCustomers.includes(order.customerId)) {
          totalSales += order.paid;
          numberOfOrders++;
        }
      });
      return totalSales / numberOfOrders || 0;
    });

    const newCustomerOrderCountValues = timePeriod.map((date) => {
      const dateStr = date.toISOString().split('T')[0];
      let newCustomerOrderCount = 0;
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0];
        //@ts-ignore
        if (orderDate === dateStr && newCustomers[order.customerId] === order.date) {
          newCustomerOrderCount++;
        }
      });
      return newCustomerOrderCount;
    });

    const totalCustomerValues = timePeriod.map((date) => {
      const uniqueCustomers = new Set();
      orders.forEach((order) => {
        const orderDate = order.date.toISOString().split('T')[0]
          if (date.toISOString().split('T')[0] === orderDate) {
              uniqueCustomers.add(order.customerId); // Add customer ID to the set
          }
      });
      return uniqueCustomers.size; // Return the number of unique customers
    });

    const metricsData = [
      {
        name: 'Total Sales',
        description: 'Equates to gross sales - discounts - returns + taxes + shipping charges.',
        values: totalSalesValues,
      },
      {
        name: 'Taxes',
        description: 'The total amount of taxes charged on orders during this period.',
        values: taxesValues,
      },
      {
        name: 'Net Sales',
        description: 'Equates to gross sales + shipping - taxes - discounts - returns.',
        values: netSalesValues,
      },
      {
        name: 'COGS',
        description: 'Equates to Product Costs + Shipping Costs + Fulfillment Costs + Packing Fees + Transaction Fees',
        values: cogsValues,
      },
      {
        name: 'Gross Profit',
        description: 'Calculated by subtracting Cost of Goods (COGS) from Net Sales.',
        values: grossProfitValues,
      },
      {
        name: 'Gross Profit %',
        description: 'Gross Profit as a % of Net Sales',
        values: grossProfitMarginValues,
      },
      {
        name: 'COGS %',
        description: 'Cost of Goods (COGS) as % of Net Sales',
        values: cogsMarginValues,
      },
      {
        name: 'Orders',
        description: 'Number of orders',
        values: ordersValues,
      },
      {
        name: 'New Customer Orders',
        description: 'Number of orders from new customers',
        values: newCustomerOrderCountValues
      },
      {
        name: 'New Customers',
        description: 'The number of first-time buyers during a specific period.',
        values: newCustomerCountValues,
      },
      {
        name: 'Repeat Customers',
        description: 'Customers who have made more than one purchase in their order history.',
        values: repeatCustomerCountValues,
      },
      {
        name: 'New Customer Sales',
        description: 'Net Sales generated from new customers during this time period.',
        values: newCustomerSalesValues
      },
      {
        name: "Repeat Customer Sales", 
        description: "Net Sales generated from existing customers during this time period.",
        values: repeatCustomerSalesValues
      },
      {
        name: "New Customer AOV", 
        description: "Average Value of Each Order from a New Customer. Total New Customer Sales / Number of New Customers.",
        values: newCustomerAovValues
      },
      {
        name: "Repeat Customer AOV", 
        description: "Average Value of Each Order from a Repeat Customer. Total Repeat Customer Sales / Number of Repeat Customers.",
        values: repeatCustomerAovValues
      },
      {
        name: 'AOV',
        description: 'Average Value of Each Order Total Sales / Orders',
        values: aovValues,
      },
      {
        name: 'Average No Of Items',
        description: 'The average number of items per order. | Total Items Ordered / Total Orders.',
        values: anoiValues,
      },
      {
        name: "Total Customers", 
        description: "The total number of unique customers who have made a purchase.",
        values: totalCustomerValues
      }
    ];

    for (const metric of metricsData) {
      for (let i = 0; i < timePeriod.length; i++) {
        if(metric.values[i]){
          await prisma.metric.upsert({
            where: {
              shopId_date_metricType: {
                shopId,
                date: timePeriod[i],
                metricType: metric.name,
              },
            },
            update: {
              value: metric.values[i],
              description: metric.description,
            },
            create: {
              shopId,
              date: timePeriod[i],
              metricType: metric.name,
              value: metric.values[i],
              description: metric.description,
            },
          });
        }
      }
    }

    res.status(200).json({
      message: "metrics resynced successfully",
      syncTime: new Date()
    });
  } catch (e) {
    console.error('Error exporting metric data:', e);
    res.status(500).send('Internal Server Error');
  }
});


router.post('/fetch-metrics', async (req: Request, res: Response) => {
  const { shopId, startDate, endDate } = req.body;

  if (!shopId || !startDate || !endDate) {
    return res.status(400).send('Missing required parameters: shopId, startDate, or endDate');
  }

  try {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const metrics = await prisma.metric.findMany({
      where: {
        shopId,
        date: {
          gte: start,
          lte: end,
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    const labels: string[] = eachDayOfInterval({ start, end }).map(date => format(date, 'd MMM'));
    const metricsData: { [key: string]: any } = {};

    let gpCount = 0;
    let cogsCount = 0;
    let totalOrders = 0;
    let totalAOVSum = 0;
    let totalNewAOVSum = 0;
    let totalRepeatAOVSum = 0;
    let totalANOISum = 0;
    let totalNewCustomerOrders = 0;

    // Initialize metricsData with arrays of zeros for the time period
    // const metricTypes = [
    //   "Total Sales", "Taxes", "Net Sales", "COGS", "Gross Profit",
    //   "Gross Profit %", "COGS %", "Orders", "New Customers", "Repeat Customers",
    //   "AOV", "Average No Of Items"
    // ];

    const metricTypes = [
      {name: "Total Sales", description: "Equates to gross sales - discounts - returns + taxes + shipping charges.", prefix: "₹", suffix: ""},
      {name: "Taxes", description: "The total amount of taxes charged on orders during this period.", prefix: "₹", suffix: ""},
      {name: "Net Sales", description: "Equates to gross sales + shipping - taxes - discounts - returns.", prefix: "₹", suffix: ""},
      // {name: "Returns", description: "The value of goods returned by a customer."},
      {name: "COGS", description: "Equates to Product Costs + Shipping Costs + Fulfillment Costs + Packing Fees + Transaction Fees", prefix: "₹", suffix: ""},
      {name: "COGS %", description: "Cost of Goods (COGS) as % of Net Sales", prefix: "", suffix: "%"},
      // {name: "Shipping Paid", description: "Shipping paid by customers as part of orders during this period."},
      // {name: "Shipping Cost", description: "The shipping cost paid by you to shipping providers. This amount is set under"},
      // {name: "Transaction Fees", description: "Card processing fees paid by customers as part of the order process. Includes FX fees charged by your payment processor for International Cards. Update under"},
      // {name: "Fulfillment Costs", description: "Cost of Fulfillment Pick & Pack Fees"},
      {name: "Gross Profit", description: "Calculated by subtracting Cost of Goods (COGS) from Net Sales.", prefix: "₹", suffix: ""},
      {name: "Gross Profit %", description: "Gross Profit as a % of Net Sales", prefix: "", suffix: "%"},
      // {name: "Contribution Margin", description: "Net sales - COGS - Marketing Costs = Contribution Margin"},
      // {name: "Contribution Margin %", description: "Contribution Margin as a % of Net Sales"},
      // {name: "New Customer Contribution Margin", description: "The contribution margin (gross profit after marketing costs) you've earned from new customers. Keeping this above 0 means you are first order profitable. New Customer Net Sales - New Customer COGS - Total Marketing Spend"},
      // {name: "Operational Expenses", description: "Costs related to the operation of the business that aren’t directly tied to producing goods or services (e.g., rent, utilities, salaries). Add under Other Costs"},
      // {name: "Operational Expenses %", description: "Operating Expenses as % of Net Sales"},
      // {name: "Net Profit", description: "Net Sales - COGS - Marketing Costs - Operating Expenses = Net Profit"},
      // {name: "Net Profit %", description: "Net Profit as a % of Net Sales"},
      // {name: "Staff Cost %", description: "The cost of Staff inputted under the Staff Settings tab as a % of Net Sales"},
      {name: "Orders", description: "Number of orders", prefix: "", suffix: ""},
      {name: 'New Customer Orders', description: 'Number of orders from new customers', prefix: "", suffix: ""},
      // {name: "Total Ad Spend", description: "The total cost of paid advertising across connected channels during this period."},
      // {name: "Marketing %", description: "Marketing Costs (Ad Spend and Marketing Categorised Expenses) as a % of net sales. (Ad Spend+Marketing Expenses)/Net Sales"},
      // {name: "Total Sales MER", description: "Marketing Efficiency Ratio | Total return on your total marketing spend. | Net Sales / Marketing Spend"},
      // {name: "MER", description: "Marketing Efficiency Ratio | Total return on your total marketing spend. | Net Sales / Marketing Spend"},
      // {name: "BEP MER", description: "Breakeven Ratio of Marketing Spend | The minimum return on your marketing spend needed to break even. | Net Sales - COGS - Operating Expenses = Breakeven Marketing Spend | Gross Profit / Breakeven Marketing Spend = BEP MER"},
      // {name: "BEP ROAS", description: "The minimum ROAS (Return on Ad Spend) needed to cover your cost of goods. Net Sales / ( Net Sales – Total cost of goods) = Breakeven ROAS"},
      // {name: "Cost Per Acquisition", description: "The total cost to Acquire a New Customer. Ad Spend + Marketing Spend / Number of New Customers."},
      // {name: "New Customer Acquisition Cost", description: "Cost to Acquire a New Customer. Ad Spend + Marketing Spend / Number of New Customers."},
      // {name: "Acquisition MER", description: "Ratio of new customer revenue to ad spend. This metrics tells us how efficiently you're turning ad spend into revenue from new customers. Total New Customer Revenue / Total Ad Spend"},
      {name: "New Customers", description: "The number of first-time buyers during a specific period.", prefix: "", suffix: ""},
      {name: "Repeat Customers", description: "Customers who have made more than one purchase in their order history.", prefix: "", suffix: ""},
      {name: "New Customer Sales", description: "Net Sales generated from new customers during this time period.", prefix: "₹", suffix: ""},
      {name: "Repeat Customer Sales", description: "Net Sales generated from existing customers during this time period.", prefix: "₹", suffix: ""},
      // {name: "Gross Profit Per New Customer", description: "New Customer Net Sales - New Customer COGS."},
      // {name: "Gross Profit Per Repeat Customer", description: "Repeat Customer Net Sales - Repeat Customer COGS."},
      {name: "New Customer AOV", description: "Average Value of Each Order from a New Customer. Total New Customer Sales / Number of New Customers.", prefix: "₹", suffix: ""},
      {name: "Repeat Customer AOV", description: "Average Value of Each Order from a Repeat Customer. Total Repeat Customer Sales / Number of Repeat Customers.", prefix: "₹", suffix: ""},
      {name: "AOV", description: "Average Value of Each Order Total Sales / Orders", prefix: "₹", suffix: ""},
      {name: "Average No Of Items", description: "The average number of items per order. | Total Items Ordered / Total Orders.", prefix: "", suffix: ""},
      {name: "Total Customers", description: "The total number of unique customers who have made a purchase.", prefix: "", suffix: ""}
    ];

    metricTypes.forEach(metricType => {
      metricsData[metricType.name] = {
        name: metricType.name,
        description: metricType.description,
        prefix: metricType.prefix,
        suffix: metricType.suffix,
        values: new Array(labels.length).fill(0),
        total: 0,
      };
    });

    metrics.forEach((metric) => {
    
      const dateStr = format(new Date(metric.date.toISOString().split('T')[0]), 'd MMM');
      const dateIndex = labels.indexOf(dateStr);

      console.log(metric.date, dateStr, dateIndex)

      if (!metricsData[metric.metricType]) {
        console.error(`Unexpected metricType: ${metric.metricType}`);
        return;
      }

      metricsData[metric.metricType].values[dateIndex] = metric.value;

      if (metric.metricType === "Gross Profit %") {
        if (metric.value) {
          metricsData[metric.metricType].total += metric.value;
          gpCount++;
        }
      } else if (metric.metricType === "COGS %") {
        if (metric.value) {
          metricsData[metric.metricType].total += metric.value;
          cogsCount++;
        }
      } else if (metric.metricType === "AOV") {
        if (metric.value) {
          totalAOVSum += metric.value * metricsData["Orders"].values[dateIndex];
        }
      } else if (metric.metricType === "New Customer AOV") {
        if (metric.value) {
          totalNewAOVSum += metric.value * metricsData["New Customer Orders"].values[dateIndex];
        }
      } else if (metric.metricType === "Repeat Customer AOV") {
        if (metric.value) {
          totalRepeatAOVSum += metric.value * (metricsData["Orders"].values[dateIndex] - metricsData["New Customer Orders"].values[dateIndex]);
        }
      } else if (metric.metricType === "Average No Of Items") {
        if (metric.value) {
          totalANOISum += metric.value * metricsData["Orders"].values[dateIndex];
        }
      } else if (metric.metricType === "Orders") {
        totalOrders += metric.value;
        metricsData[metric.metricType].total += metric.value;
      } else if (metric.metricType === "New Customer Orders") {
        totalNewCustomerOrders += metric.value;
        metricsData[metric.metricType].total += metric.value;
      } else {
        metricsData[metric.metricType].total += metric.value;
      }
    });

    if (gpCount > 0) {
      metricsData["Gross Profit %"].total /= gpCount;
    }
    if (cogsCount > 0) {
      metricsData["COGS %"].total /= cogsCount;
    }
    if (totalOrders > 0) {
      metricsData["AOV"].total = totalAOVSum / totalOrders;
      metricsData["Average No Of Items"].total = totalANOISum / totalOrders;
      metricsData["Repeat Customer AOV"].total = totalRepeatAOVSum / (totalOrders - totalNewCustomerOrders);
    }
    if (totalNewCustomerOrders > 0) {
      metricsData["New Customer AOV"].total = totalNewAOVSum / totalNewCustomerOrders
    }

    const response = Object.values(metricsData).map((metric: any) => {
      metric.total = metric.total.toFixed(2);
      metric.values = metric.values.map((v: any) => parseFloat(v.toFixed(2)))
      return metric;
    });

    res.status(200).json({ metrics: response, labels });
  } catch (e) {
    console.error('Error fetching metric data:', e);
    res.status(500).send('Internal Server Error');
  }
});

router.post('/fetch-finance-metrics', async (req: Request, res: Response) => {
  const { shopId, startDate, endDate } = req.body;

  if (!shopId || !startDate || !endDate) {
    return res.status(400).send('Missing required parameters: shopId, startDate, or endDate');
  }

  try {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const metrics = await prisma.metric.findMany({
      where: {
        shopId,
        date: {
          gte: start,
          lte: end,
        },
      },
      orderBy: {
        date: 'asc',
      },
    });

    console.log(metrics)

    const labels: string[] = eachDayOfInterval({ start, end }).map(date => format(date, 'MM-dd-yyyy'));
    const metricsData: { [key: string]: any } = {};

    let gpCount = 0;

    const metricTypes = [
      {name: "Total Sales", description: "Equates to gross sales - discounts - returns + taxes + shipping charges.", prefix: "₹", suffix: ""},
      {name: "COGS", description: "Equates to Product Costs + Shipping Costs + Fulfillment Costs + Packing Fees + Transaction Fees", prefix: "₹", suffix: ""},
      {name: "Gross Profit", description: "Calculated by subtracting Cost of Goods (COGS) and marketing costs from Net Sales.", prefix: "₹", suffix: ""},
      {name: "Gross Profit %", description: "Net Profit as a % of Net Sales", prefix: "", suffix: "%"},
    ]

    metricTypes.forEach(metricType => {
      metricsData[metricType.name] = {
        name: metricType.name,
        description: metricType.description,
        prefix: metricType.prefix,
        suffix: metricType.suffix,
        values: new Array(labels.length).fill(0),
        total: 0,
      };
    });

    metrics.forEach((metric) => {

      const dateStr = format(new Date(metric.date.toISOString().split('T')[0]), 'MM-dd-yyyy');
      const dateIndex = labels.indexOf(dateStr);

      console.log(metric.date, dateStr, dateIndex)

      if (!metricsData[metric.metricType]) {
        console.error(`Unexpected metricType: ${metric.metricType}`);
      } else {
        metricsData[metric.metricType].values[dateIndex] = metric.value;
        
        if (metric.metricType === "Gross Profit %") {
          if (metric.value) {
            metricsData[metric.metricType].total += metric.value;
            gpCount++;
          }
        } else {
          metricsData[metric.metricType].total += metric.value;
        }
      }

    })

    if (gpCount > 0) {
      metricsData["Gross Profit %"].total /= gpCount;
    }

    const response = Object.values(metricsData).map((metric: any) => {
      if (metric.name === "Gross Profit") {
        metric.name = "Net Profit"
      }
      if (metric.name === "Gross Profit %") {
        metric.name = "Net Profit %"
      }
      metric.total = metric.total.toFixed(2);
      metric.values = metric.values.map((v: any) => parseFloat(v.toFixed(2)))
      return metric;
    });

    res.status(200).json({ metrics: response, labels });

  } catch (e) {
    console.error('Error fetching metric data:', e);
    res.status(500).send('Internal Server Error');
  }
})


router.post('/spotlight', async (req: Request, res: Response) => {
  const { shopId, startDate, endDate } = req.body;

  if (!shopId || !startDate || !endDate) {
    return res.status(400).send('Missing required parameters: shopId, startDate, or endDate');
  }

  try {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const orders = await prisma.order.findMany({
      where: {
        storeId: shopId,
        date: {
          gte: start,
          lte: end,
        },
      },
      include: {
        lineItems: true,
      },
    });

    let biggestMover = { name: "", amount: 0 };
    let bestSeller = { name: "", quantity: 0 };
    let topCustomer = { name: "", amount: 0 };

    if (!orders.length) {
      return res.status(200).json({
        biggestMover,
        bestSeller,
        topCustomer,
      })
    }

    // Calculate biggestMover, bestSeller, and topCustomer
    const productSales = new Map<string, { amount: number; quantity: number }>();
    const customerSpending = new Map<string, number>();

    orders.forEach((order) => {
      // Calculate topCustomer
      if (order.customer) {
        customerSpending.set(order.customer, (customerSpending.get(order.customer) || 0) + order.paid);
      }

      // Calculate biggestMover and bestSeller
      order.lineItems.forEach((item) => {
        const productStats = productSales.get(item.productId) || { amount: 0, quantity: 0 };
        productStats.amount += item.paid;
        productStats.quantity += item.quantity;
        productSales.set(item.productId, productStats);
      });
    });

    console.log(orders)

    // Determine biggestMover, bestSeller, and topCustomer

    productSales.forEach((stats, productId) => {
      if (stats.amount > biggestMover.amount) {
        biggestMover = { name: productId, amount: stats.amount };
      }
      if (stats.quantity > bestSeller.quantity) {
        bestSeller = { name: productId, quantity: stats.quantity };
      }
    });

    biggestMover.name = (await prisma.product.findUnique({
      where: {
        storeId: shopId,
        productId: biggestMover.name
      }
    }))?.title || ""

    bestSeller.name = (await prisma.product.findUnique({
      where: {
        storeId: shopId,
        productId: bestSeller.name
      }
    }))?.title || ""

    customerSpending.forEach((amount, customer) => {
      if (amount > topCustomer.amount) {
        topCustomer = { name: customer, amount };
      }
    });

    res.json({
      biggestMover,
      bestSeller,
      topCustomer,
    });
  } catch (e) {
    console.error('Error fetching spotlight data:', e);
    res.status(500).send('Internal Server Error');
  }
});


router.post('/old-metrics', async(req: Request, res: Response) => {
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