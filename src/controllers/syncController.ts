import { PrismaClient } from "@prisma/client";
import Shopify from "shopify-api-node";
import { fetchAndProcessOrders, getDatesInInterval } from "../routes/store";
import { subYears } from "date-fns";

interface Store {
    shopifyName: string;
    accessToken: string;
}

export const syncStoreData = async(storeId: string, prisma: PrismaClient) => {
    const store: Store | null = await prisma.store.findUnique({
        where: { id: storeId },
        select: { shopifyName: true, accessToken: true }
    });
  
    if (!store) {
        return {
            error: "cannot find store"
        }
    }

    const { shopifyName: shopName, accessToken } = store;

    const shopify = new Shopify({
      shopName: shopName,
      accessToken: accessToken,
    });

    const currentTime = new Date();

    // Fetch and process orders in batches
    await fetchAndProcessOrders(shopify, storeId, currentTime);

    await prisma.store.update({
      where: { id: storeId },
      data: { lastOrderSync: currentTime },
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

    await prisma.store.update({
      where: { id: storeId },
      data: { lastProductSync: currentTime },
    });

    const orders = await prisma.order.findMany({
        where: { storeId },
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
  
      const metricCurrentTime = new Date()
  
      await prisma.store.update({
        where: { id: storeId },
        data: { lastMetricSync: metricCurrentTime },
      });
}