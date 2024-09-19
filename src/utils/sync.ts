import { PrismaClient } from "@prisma/client";
import Shopify from "shopify-api-node";

import { subMonths } from "date-fns";
import getSymbolFromCurrency from "currency-symbol-map";
import { getDatesInInterval } from "./date";
import { start } from "repl";

const fetchAndProcessOrders = async (shopify: Shopify, shopId: string, currentTime: Date, prisma: PrismaClient): Promise<void> => {

  const startDate = subMonths(currentTime, 6)

  let params: any = {
    limit: 250,
    created_at_min: startDate.toISOString(),
    created_at_max: currentTime.toISOString(),
  };

  let currencyUpdated = false

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

        if(!currencyUpdated) {
          const currencyCode = order.current_total_price_set.shop_money.currency_code
          const currencySymbol = getSymbolFromCurrency(currencyCode)
          await prisma.store.update({
            where: {
              id: shopId
            },
            data: {
              currency: `${currencySymbol} ${currencyCode}`,
            }
          })
          currencyUpdated = true
        }

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

export const syncStoreData = async(storeId: string, prisma: PrismaClient) => {
    const store = await prisma.store.findUnique({
        where: { id: storeId },
        select: { shopifyName: true, accessToken: true, name: true }
    });
  
    if (!store) {
      console.error("cannot find store")
      return {
        error: "cannot find store"
      }
    }

    console.log(`data sync started for ${store.name} at ${new Date().toLocaleTimeString()}`)

    const { shopifyName: shopName, accessToken } = store;

    const shopify = new Shopify({
      shopName: shopName,
      accessToken: accessToken,
    });

    const currentTime = new Date();

    // Fetch and process orders in batches
    await fetchAndProcessOrders(shopify, storeId, currentTime, prisma);

    console.log(`successfully fetched and stored orders for ${store.name} at ${new Date().toLocaleTimeString()}`)

    await prisma.store.update({
      where: { id: storeId },
      data: { lastSync: currentTime },
    });

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
            storeId,
          },
          create: {
            productId: product.id.toString(),
            title: product.title,
            storeId,
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

    console.log(`successfully fetched and stored products for ${store.name} at ${new Date().toLocaleTimeString()}`)

      const orders = await prisma.order.findMany({
        where: { storeId },
        include: { lineItems: true },
      });
  
      const endDate = new Date();
      const startDate = subMonths(endDate, 6);
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

      const purchaseRevenueValues = timePeriod.map((date) => {
        let purchaseRevenue = 0;
        orders.forEach((order) => {
          const orderDate = order.date.toISOString().split('T')[0];
          if (date.toISOString().split('T')[0] === orderDate) {
            order.lineItems.forEach( (item) => {
              purchaseRevenue += item.paid
            })
          }
        })
        return purchaseRevenue
      })
  
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
        where: { shopId: storeId },
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
            customerId_shopId: { customerId, shopId: storeId },
          },
          update: {
            orderDates,
          },
          create: {
            customerId,
            shopId: storeId,
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
        },
        {
          name: "Purchase Revenue",
          description: "Income generated from the sale of goods, calculated by multiplying the number of units sold by the price per unit",
          values: purchaseRevenueValues
        }
      ];
  
      for (const metric of metricsData) {
        for (let i = 0; i < timePeriod.length; i++) {
          if(metric.values[i]){
            await prisma.metric.upsert({
              where: {
                shopId_date_metricType: {
                  shopId: storeId,
                  date: timePeriod[i],
                  metricType: metric.name,
                },
              },
              update: {
                value: metric.values[i],
                description: metric.description,
              },
              create: {
                shopId: storeId,
                date: timePeriod[i],
                metricType: metric.name,
                value: metric.values[i],
                description: metric.description,
              },
            });
          }
        }
      }

  console.log(`successfully computed and stored metrics for ${store.name} at ${new Date().toLocaleTimeString()}`)

  await prisma.store.update({
    data: {
      syncing: false,
    },
    where: {
      id: storeId
    }
  })

  console.log(`successfully set syncing false for ${store.name} at ${new Date().toLocaleTimeString()}`)
}

export const syncStoreData2 = async(storeId: string, prisma: PrismaClient ) => {

  const store = await prisma.store.findUnique({
    where: { id: storeId },
  });

  if (!store) {
      return {
          error: "cannot find store"
      }
  }

  console.log(`data sync started for ${store.name} at ${new Date().toTimeString()}`)

  const currentTime = new Date();

  const { shopifyName:shopName , accessToken, lastSync } = store;

  const shopify = new Shopify({
    shopName: shopName,
    accessToken: accessToken,
  });

  let hasMoreOrders = true;

  const startDate = subMonths(currentTime, 6)
  startDate.setHours(0,0,0,0)

  let orderParams: any = {
    limit: 250,
    created_at_min: startDate.toISOString(),
    created_at_max: currentTime.toISOString(),
    order: 'created_at asc',
  };

  const timePeriod = getDatesInInterval(startDate, currentTime);

  const customerOrderHistory =  {} as { [key: string]: Date[] }

  // Initialize metric objects
  const metrics: { [key: string]: number[] } = {
    totalSales: Array(timePeriod.length).fill(0),
    taxes: Array(timePeriod.length).fill(0),
    netSales: Array(timePeriod.length).fill(0),
    cogs: Array(timePeriod.length).fill(0),
    grossProfit: Array(timePeriod.length).fill(0),
    orders: Array(timePeriod.length).fill(0),
    newCustomerOrders: Array(timePeriod.length).fill(0),
    newCustomers: Array(timePeriod.length).fill(0),
    repeatCustomers: Array(timePeriod.length).fill(0),
    newCustomerSales: Array(timePeriod.length).fill(0),
    repeatCustomerSales: Array(timePeriod.length).fill(0),
    totalItems: Array(timePeriod.length).fill(0),
    totalCustomers: Array(timePeriod.length).fill(0),
    purchaseRevenue: Array(timePeriod.length).fill(0),
  };

  const totalCustomers = Array.from({ length: timePeriod.length }, () => new Set())
  const uniqueCustomers = new Set<string>();
  const newCustomers = new Set<string>();
  const repeatCustomers = new Set<string>();

  // Helper function to check if a customer is new
  const isNewCustomer = (customerId: string, orderDate: Date) => {
    if (!customerOrderHistory[customerId]) return true;
    return !customerOrderHistory[customerId].some(date => date < orderDate);
  };

  while (hasMoreOrders) {
    console.log("fetching orders from shopify", orderParams)
    
    const orders = await shopify.order.list(orderParams);

    console.log('orders fetched successfully from shopify')

    if (orders.length < orderParams.limit) {
      hasMoreOrders = false;
    } else {
      const page_info = orders.nextPageParameters?.page_info;
      orderParams = {
        limit: 250,
        page_info,
      }
    }

    const prismaOrders = []

    for (const order of orders) {
      // Calculate grossProfit and cogs for the order
      const paid = parseFloat(order.total_price);
      const tax = parseFloat(order.total_tax)
      const cogs = (paid - tax) * 0.34;
      const grossProfit = paid - cogs;

      const orderToPush = await prisma.order.create({
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
          storeId,
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
        },
        include: {
          lineItems: true
        }
      });

      prismaOrders.push(orderToPush)
    }

    for (const order of prismaOrders) {
      const orderDate = order.date.toISOString().split('T')[0];
      const dateIndex = timePeriod.findIndex(date => date.toISOString().split('T')[0] === orderDate);
      
      if (dateIndex === -1) continue;
  
      const { customerId, paid, tax, cogs } = order;
      const netSale = paid - tax;
      metrics.totalSales[dateIndex] += paid;
      metrics.taxes[dateIndex] += tax;
      metrics.netSales[dateIndex] += netSale;
      metrics.cogs[dateIndex] += cogs;
      metrics.grossProfit[dateIndex] += netSale - cogs;
      metrics.orders[dateIndex]++;
      metrics.purchaseRevenue[dateIndex] += order.lineItems.reduce((sum, item) => sum + item.paid, 0);
      metrics.totalItems[dateIndex] += order.lineItems.reduce((sum, item) => sum + item.quantity, 0);
  
      uniqueCustomers.add(customerId);
      totalCustomers[dateIndex].add(customerId)
      
      if (isNewCustomer(customerId, order.date)) {
        newCustomers.add(customerId);
        metrics.newCustomers[dateIndex]++;
        metrics.newCustomerOrders[dateIndex]++;
        metrics.newCustomerSales[dateIndex] += netSale;
      } else {
        repeatCustomers.add(customerId);
        metrics.repeatCustomers[dateIndex]++;
        metrics.repeatCustomerSales[dateIndex] += netSale;
      }
      
      if (!customerOrderHistory[customerId]) {
        customerOrderHistory[customerId] = [];
      }
      customerOrderHistory[customerId].push(order.date);
    }
  }

  console.log(`fetched and stored orders successfully for ${store.name} at ${new Date().toTimeString()}`)

  let hasMoreProducts = true;
    let productParams: any = {
      limit: 250,
      updated_at_max: currentTime.toISOString(),
    };

  while (hasMoreProducts) {
      console.log('fetching products with parameters', productParams)
      const products = await shopify.product.list(productParams);
      console.log('successfully fetched products')

      if (products.length < productParams.limit) {
        hasMoreProducts = false;
      } else {
        const page_info = products.nextPageParameters?.page_info;
        productParams = { 
          limit: 250,
          page_info,
        };
      }

      try {
        for (const product of products) {
          const createdProduct = await prisma.product.upsert({
            where: { productId: product.id.toString() },
            update: {
              title: product.title,
              storeId,
            },
            create: {
              productId: product.id.toString(),
              title: product.title,
              storeId,
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
      } catch(e) {
        console.error("error while updating products", e)
      }
  }

  console.log(`fetched and stored products successfully for ${store.name} at ${new Date().toTimeString()}`)

  // Calculate derived metrics
  const derivedMetrics = {
    grossProfitMargin: metrics.grossProfit.map((v, i) => metrics.netSales[i] ? (v / metrics.netSales[i]) * 100 : 0),
    cogsMargin: metrics.cogs.map((v, i) => metrics.netSales[i] ? (v / metrics.netSales[i]) * 100 : 0),
    aov: metrics.totalSales.map((v, i) => metrics.orders[i] ? v / metrics.orders[i] : 0),
    anoi: metrics.totalItems.map((v, i) => metrics.orders[i] ? v / metrics.orders[i] : 0),
    newCustomerAov: metrics.newCustomerSales.map((v, i) => metrics.newCustomerOrders[i] ? v / metrics.newCustomerOrders[i] : 0),
    repeatCustomerAov: metrics.repeatCustomerSales.map((v, i) => (metrics.orders[i] - metrics.newCustomerOrders[i]) ? v / (metrics.orders[i] - metrics.newCustomerOrders[i]) : 0),
    totalCustomers: totalCustomers.map((v) => v.size)
  };

  console.log("calculated derived metrics successfully")
  // Save updated customer order histories
  for (const [customerId, orderDates] of Object.entries(customerOrderHistory)) {
    await prisma.customerOrderHistory.upsert({
      where: {
        customerId_shopId: { customerId, shopId: storeId },
      },
      update: {
        orderDates,
      },
      create: {
        customerId,
        shopId: storeId,
        orderDates,
      },
    });
  }

  console.log('updated customer orders history sucessfully')
  // Define metrics data
  const metricsData = [
    { name: 'Total Sales', description: 'Equates to gross sales - discounts - returns + taxes + shipping charges.', values: metrics.totalSales },
    { name: 'Taxes', description: 'The total amount of taxes charged on orders during this period.', values: metrics.taxes },
    { name: 'Net Sales', description: 'Equates to gross sales + shipping - taxes - discounts - returns.', values: metrics.netSales },
    { name: 'COGS', description: 'Equates to Product Costs + Shipping Costs + Fulfillment Costs + Packing Fees + Transaction Fees', values: metrics.cogs },
    { name: 'Gross Profit', description: 'Calculated by subtracting Cost of Goods (COGS) from Net Sales.', values: metrics.grossProfit },
    { name: 'Gross Profit %', description: 'Gross Profit as a % of Net Sales', values: derivedMetrics.grossProfitMargin },
    { name: 'COGS %', description: 'Cost of Goods (COGS) as % of Net Sales', values: derivedMetrics.cogsMargin },
    { name: 'Orders', description: 'Number of orders', values: metrics.orders },
    { name: 'New Customer Orders', description: 'Number of orders from new customers', values: metrics.newCustomerOrders },
    { name: 'New Customers', description: 'The number of first-time buyers during a specific period.', values: metrics.newCustomers },
    { name: 'Repeat Customers', description: 'Customers who have made more than one purchase in their order history.', values: metrics.repeatCustomers },
    { name: 'New Customer Sales', description: 'Net Sales generated from new customers during this time period.', values: metrics.newCustomerSales },
    { name: "Repeat Customer Sales", description: "Net Sales generated from existing customers during this time period.", values: metrics.repeatCustomerSales },
    { name: "New Customer AOV", description: "Average Value of Each Order from a New Customer. Total New Customer Sales / Number of New Customers.", values: derivedMetrics.newCustomerAov },
    { name: "Repeat Customer AOV", description: "Average Value of Each Order from a Repeat Customer. Total Repeat Customer Sales / Number of Repeat Customers.", values: derivedMetrics.repeatCustomerAov },
    { name: 'AOV', description: 'Average Value of Each Order Total Sales / Orders', values: derivedMetrics.aov },
    { name: 'Average No Of Items', description: 'The average number of items per order. | Total Items Ordered / Total Orders.', values: derivedMetrics.anoi },
    { name: "Total Customers", description: "The total number of unique customers who have made a purchase.", values: derivedMetrics.totalCustomers },
    { name: "Purchase Revenue", description: "Income generated from the sale of goods, calculated by multiplying the number of units sold by the price per unit", values: metrics.purchaseRevenue }
  ];

  console.log('started storing metrics')
  // Save metrics to the database

  try {
    for (const metric of metricsData) {
      console.log(`updating metric ${metric.name}`)
      for (let i = 0; i < timePeriod.length; i++) {
        if(metric.values[i]){
          await prisma.metric.upsert({
            where: {
              shopId_date_metricType: {
                shopId: storeId,
                date: timePeriod[i],
                metricType: metric.name,
              },
            },
            update: {
              value: metric.values[i],
              description: metric.description,
            },
            create: {
              shopId: storeId,
              date: timePeriod[i],
              metricType: metric.name,
              value: metric.values[i],
              description: metric.description,
            },
          });
        }
      }
    }
  } catch(e) {
    console.error("error while uploading metrics", e)
  }

  console.log(`calculated and stored metrics successfully for ${store.name} at ${new Date().toTimeString()}`)

  // Update lastSync time in the database to current time
  await prisma.store.update({
    where: { id: storeId },
    data: { 
      lastSync: currentTime, 
      syncing: false
    },
  });

  console.log(`data sync completed successfully for ${store.name} at ${new Date().toTimeString()}`)
}

export const resyncStoreData = async(storeId: string, prisma: PrismaClient, currentTime: Date) => {

  const store = await prisma.store.findUnique({
    where: { id: storeId },
  });

  if (!store) {
      return {
          error: "cannot find store"
      }
  }

  const { shopifyName:shopName , accessToken, lastSync } = store;

  const shopify = new Shopify({
    shopName: shopName,
    accessToken: accessToken,
  });

  let hasMoreOrders = true;
  let orderParams: any = {
    limit: 250,
    created_at_min: lastSync.toISOString(),
    created_at_max: currentTime.toISOString(),
  };

  while (hasMoreOrders) {
    const orders = await shopify.order.list(orderParams);

    if (orders.length < orderParams.limit) {
      hasMoreOrders = false;
    } else {
      const page_info = orders.nextPageParameters?.page_info;
      orderParams = {
        limit: 250,
        page_info,
      }
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
          storeId,
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

  let hasMoreProducts = true;
    let productParams: any = {
      limit: 250,
      updated_at_min: lastSync.toISOString(),
      updated_at_max: currentTime.toISOString(),
    };

  while (hasMoreProducts) {
      const products = await shopify.product.list(productParams);

      if (products.length < productParams.limit) {
        hasMoreProducts = false;
      } else {
        const lastProduct = products[products.length - 1];
        productParams = { ...productParams, since_id: lastProduct.id };
      }

      for (const product of products) {
        const createdProduct = await prisma.product.upsert({
          where: { productId: product.id.toString() },
          update: {
            title: product.title,
            storeId,
          },
          create: {
            productId: product.id.toString(),
            title: product.title,
            storeId,
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

  const startDate = new Date(lastSync)
  startDate.setHours(0,0,0,0)
  const orders = await prisma.order.findMany({
    where: {
      storeId,
      date: {
        gte: startDate,
      },
    },
    include: { lineItems: true },
  });

  const endDate = new Date();
  const timePeriod = getDatesInInterval(lastSync, endDate);

  // Fetch existing customer order histories
  const existingCustomers = await prisma.customerOrderHistory.findMany({
    where: { shopId: storeId },
  });

  const customerOrderHistory = existingCustomers.reduce((acc, customer) => {
    acc[customer.customerId] = customer.orderDates;
    return acc;
  }, {} as { [key: string]: Date[] });

  // Initialize metric objects
  const metrics: { [key: string]: number[] } = {
    totalSales: Array(timePeriod.length).fill(0),
    taxes: Array(timePeriod.length).fill(0),
    netSales: Array(timePeriod.length).fill(0),
    cogs: Array(timePeriod.length).fill(0),
    grossProfit: Array(timePeriod.length).fill(0),
    orders: Array(timePeriod.length).fill(0),
    newCustomerOrders: Array(timePeriod.length).fill(0),
    newCustomers: Array(timePeriod.length).fill(0),
    repeatCustomers: Array(timePeriod.length).fill(0),
    newCustomerSales: Array(timePeriod.length).fill(0),
    repeatCustomerSales: Array(timePeriod.length).fill(0),
    totalItems: Array(timePeriod.length).fill(0),
    totalCustomers: Array(timePeriod.length).fill(0),
    purchaseRevenue: Array(timePeriod.length).fill(0),
  };

  const uniqueCustomers = new Set<string>();
  const newCustomers = new Set<string>();
  const repeatCustomers = new Set<string>();

  // Helper function to check if a customer is new
  const isNewCustomer = (customerId: string, orderDate: Date) => {
    if (!customerOrderHistory[customerId]) return true;
    return !customerOrderHistory[customerId].some(date => date < orderDate);
  };

  // Process orders in a single loop
  for (const order of orders) {
    const orderDate = order.date.toISOString().split('T')[0];
    const dateIndex = timePeriod.findIndex(date => date.toISOString().split('T')[0] === orderDate);
    
    if (dateIndex === -1) continue;

    const { customerId, paid, tax, cogs } = order;
    const netSale = paid - tax;

    metrics.totalSales[dateIndex] += paid;
    metrics.taxes[dateIndex] += tax;
    metrics.netSales[dateIndex] += netSale;
    metrics.cogs[dateIndex] += cogs;
    metrics.grossProfit[dateIndex] += netSale - cogs;
    metrics.orders[dateIndex]++;
    metrics.purchaseRevenue[dateIndex] += order.lineItems.reduce((sum, item) => sum + item.paid, 0);
    metrics.totalItems[dateIndex] += order.lineItems.reduce((sum, item) => sum + item.quantity, 0);

    uniqueCustomers.add(customerId);
    metrics.totalCustomers[dateIndex] = uniqueCustomers.size;

    if (isNewCustomer(customerId, order.date)) {
      newCustomers.add(customerId);
      metrics.newCustomers[dateIndex]++;
      metrics.newCustomerOrders[dateIndex]++;
      metrics.newCustomerSales[dateIndex] += netSale;
    } else {
      repeatCustomers.add(customerId);
      metrics.repeatCustomers[dateIndex]++;
      metrics.repeatCustomerSales[dateIndex] += netSale;
    }

    if (!customerOrderHistory[customerId]) {
      customerOrderHistory[customerId] = [];
    }
    customerOrderHistory[customerId].push(order.date);
  }

  // Calculate derived metrics
  const derivedMetrics = {
    grossProfitMargin: metrics.grossProfit.map((v, i) => metrics.netSales[i] ? (v / metrics.netSales[i]) * 100 : 0),
    cogsMargin: metrics.cogs.map((v, i) => metrics.netSales[i] ? (v / metrics.netSales[i]) * 100 : 0),
    aov: metrics.totalSales.map((v, i) => metrics.orders[i] ? v / metrics.orders[i] : 0),
    anoi: metrics.totalItems.map((v, i) => metrics.orders[i] ? v / metrics.orders[i] : 0),
    newCustomerAov: metrics.newCustomerSales.map((v, i) => metrics.newCustomerOrders[i] ? v / metrics.newCustomerOrders[i] : 0),
    repeatCustomerAov: metrics.repeatCustomerSales.map((v, i) => (metrics.orders[i] - metrics.newCustomerOrders[i]) ? v / (metrics.orders[i] - metrics.newCustomerOrders[i]) : 0),
  };

  // Save updated customer order histories
  for (const [customerId, orderDates] of Object.entries(customerOrderHistory)) {
    await prisma.customerOrderHistory.upsert({
      where: {
        customerId_shopId: { customerId, shopId: storeId },
      },
      update: {
        orderDates,
      },
      create: {
        customerId,
        shopId: storeId,
        orderDates,
      },
    });
  }

  // Define metrics data
  const metricsData = [
    { name: 'Total Sales', description: 'Equates to gross sales - discounts - returns + taxes + shipping charges.', values: metrics.totalSales },
    { name: 'Taxes', description: 'The total amount of taxes charged on orders during this period.', values: metrics.taxes },
    { name: 'Net Sales', description: 'Equates to gross sales + shipping - taxes - discounts - returns.', values: metrics.netSales },
    { name: 'COGS', description: 'Equates to Product Costs + Shipping Costs + Fulfillment Costs + Packing Fees + Transaction Fees', values: metrics.cogs },
    { name: 'Gross Profit', description: 'Calculated by subtracting Cost of Goods (COGS) from Net Sales.', values: metrics.grossProfit },
    { name: 'Gross Profit %', description: 'Gross Profit as a % of Net Sales', values: derivedMetrics.grossProfitMargin },
    { name: 'COGS %', description: 'Cost of Goods (COGS) as % of Net Sales', values: derivedMetrics.cogsMargin },
    { name: 'Orders', description: 'Number of orders', values: metrics.orders },
    { name: 'New Customer Orders', description: 'Number of orders from new customers', values: metrics.newCustomerOrders },
    { name: 'New Customers', description: 'The number of first-time buyers during a specific period.', values: metrics.newCustomers },
    { name: 'Repeat Customers', description: 'Customers who have made more than one purchase in their order history.', values: metrics.repeatCustomers },
    { name: 'New Customer Sales', description: 'Net Sales generated from new customers during this time period.', values: metrics.newCustomerSales },
    { name: "Repeat Customer Sales", description: "Net Sales generated from existing customers during this time period.", values: metrics.repeatCustomerSales },
    { name: "New Customer AOV", description: "Average Value of Each Order from a New Customer. Total New Customer Sales / Number of New Customers.", values: derivedMetrics.newCustomerAov },
    { name: "Repeat Customer AOV", description: "Average Value of Each Order from a Repeat Customer. Total Repeat Customer Sales / Number of Repeat Customers.", values: derivedMetrics.repeatCustomerAov },
    { name: 'AOV', description: 'Average Value of Each Order Total Sales / Orders', values: derivedMetrics.aov },
    { name: 'Average No Of Items', description: 'The average number of items per order. | Total Items Ordered / Total Orders.', values: derivedMetrics.anoi },
    { name: "Total Customers", description: "The total number of unique customers who have made a purchase.", values: metrics.totalCustomers },
    { name: "Purchase Revenue", description: "Income generated from the sale of goods, calculated by multiplying the number of units sold by the price per unit", values: metrics.purchaseRevenue }
  ];

  // Save metrics to the database
  for (const metric of metricsData) {
    for (let i = 0; i < timePeriod.length; i++) {
      if(metric.values[i]){
        await prisma.metric.upsert({
          where: {
            shopId_date_metricType: {
              shopId: storeId,
              date: timePeriod[i],
              metricType: metric.name,
            },
          },
          update: {
            value: metric.values[i],
            description: metric.description,
          },
          create: {
            shopId: storeId,
            date: timePeriod[i],
            metricType: metric.name,
            value: metric.values[i],
            description: metric.description,
          },
        });
      }
    }
  }

  // Update lastSync time in the database to current time
  await prisma.store.update({
    where: { id: storeId },
    data: { 
      lastSync: currentTime, 
      syncing: false
    },
  });
}