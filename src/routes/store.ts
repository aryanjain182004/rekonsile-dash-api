import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { PrismaClient } from '@prisma/client';
import facebookRoutes from './facebook'
import { checkStoreSync, createStore, disconnectShopify, fetchDashboardMetrics, fetchFinanceMetrics, fetchGoals, fetchMetrics, fetchOrders, fetchProducts, fetchSpotlightData, getStores, resyncStore, syncStore, updateAccessToken, updateAdsGoal, updateGeneralSettings, updateNetSalesGoal } from '../controllers/storeController';

const router = Router();
const prisma = new PrismaClient();

router.post('/create', authMiddleware , createStore)

router.post('/update-access-token', authMiddleware, updateAccessToken)

router.post('/update-general', authMiddleware, updateGeneralSettings)

router.get('/', authMiddleware, getStores)

router.post('/synced-check', authMiddleware, checkStoreSync) 

router.post('/sync-store', authMiddleware, syncStore)

router.post('/resync-store', authMiddleware, resyncStore)

router.post('/disconnect-shopify', authMiddleware, disconnectShopify)

router.post('/fetch-dashboard-metrics', authMiddleware, fetchDashboardMetrics)

router.post('/fetch-goals', authMiddleware, fetchGoals)

router.post('/update-ads-goal', authMiddleware, updateAdsGoal)

router.post('/update-net-sales-goal', authMiddleware, updateNetSalesGoal)

// interface SyncOrdersRequest {
//   shopId: string;
// }

// interface Store {
//   shopifyName: string;
//   accessToken: string;
// }

// export const fetchAndProcessOrders = async (shopify: Shopify, shopId: string, currentTime: Date): Promise<void> => {
//   let params: any = {
//     limit: 250,
//     created_at_max: currentTime.toISOString(),
//   };

//   do {
//     try {
//       console.log('Fetching orders with params:', params);

//       const orders = await shopify.order.list(params);
//       console.log('Fetched orders:', orders.length);

//       // Insert orders into the database
//       for (const order of orders) {
//         const paid = parseFloat(order.total_price);
//         const tax = parseFloat(order.total_tax);
//         const cogs = (paid - tax) * 0.34;
//         const grossProfit = paid - cogs;

//         await prisma.order.create({
//           data: {
//             date: new Date(order.created_at),
//             orderId: order.order_number.toString(),
//             source: order.source_name,
//             customer: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Unknown',
//             customerId: order.customer?.id.toString() || "",
//             fulfillmentStatus: order.fulfillment_status ? order.fulfillment_status : "Unfulfilled",
//             paid: paid,
//             tax: tax,
//             shippingCost: 0,
//             //@ts-ignore
//             shippingPaid: parseFloat(order.total_shipping_price_set.shop_money.amount),
//             shippingCountry: order.shipping_address?.country || "N/A",
//             shippingRegion: order.shipping_address?.province_code || "N/A",
//             discount: parseFloat(order.total_discounts || "0"),
//             grossProfit: grossProfit,
//             cogs: cogs,
//             storeId: shopId,
//             lineItems: {
//               create: order.line_items.map(item => {
//                 const itemPaid = parseFloat(item.price) * item.quantity;
//                 const preTaxGrossProfit = itemPaid * 0.66;
//                 const productCost = itemPaid - preTaxGrossProfit;
//                 return {
//                   lineItemId: item.id.toString(),
//                   productId: item.product_id?.toString() || "",
//                   variantId: item.variant_id?.toString() || "",
//                   name: item.variant_title || item.title,
//                   quantity: item.quantity,
//                   paid: itemPaid,
//                   discount: parseFloat(item.total_discount),
//                   productCost: productCost,
//                   preTaxGrossProfit: preTaxGrossProfit,
//                   preTaxGrossMargin: 66
//                 };
//               })
//             }
//           }
//         });
//       }

//       // Update pagination parameters
//       const page_info = orders.nextPageParameters?.page_info;
//       params = {
//         limit: 250,
//         page_info,
//       }
//     } catch (error) {
//       console.error('Error fetching orders:', error);
//       throw error;
//     }
//   } while (params.page_info !== undefined);
// };

// router.post('/sync-orders', async (req: Request, res: Response) => {
//   const { shopId }: SyncOrdersRequest = req.body;

//   if (!shopId) {
//     return res.status(400).send('Missing required parameter: shopId');
//   }

//   try {
//     // Fetch shop details from the database
//     const store: Store | null = await prisma.store.findUnique({
//       where: { id: shopId },
//       select: { shopifyName: true, accessToken: true }
//     });

//     if (!store) {
//       return res.status(404).send('Store not found');
//     }

//     const { shopifyName: shopName, accessToken } = store;

//     const shopify = new Shopify({
//       shopName: shopName,
//       accessToken: accessToken,
//     });

//     const currentTime = new Date();

//     // Fetch and process orders in batches
//     await fetchAndProcessOrders(shopify, shopId, currentTime);

//     await prisma.store.update({
//       where: { id: shopId },
//       data: { lastSync: currentTime },
//     });

//     res.status(200).send('Orders and LineItems have been synced successfully.');
//   } catch (error) {
//     console.error('Error syncing orders:', error);
//     res.status(500).send('Internal Server Error');
//   }
// });


// router.post('/resync-orders', async (req: Request, res: Response) => {
//   const { shopId } = req.body;

//   if (!shopId) {
//     return res.status(400).send('Missing required parameter: shopId');
//   }

//   try {
//     // Fetch store information from the database using shopId
//     const store = await prisma.store.findUnique({
//       where: { id: shopId },
//     });

//     if (!store) {
//       return res.status(404).send('Store not found');
//     }

//     const { shopifyName: shopName, accessToken, lastSync } = store;
//     const shopify = new Shopify({
//       shopName: shopName,
//       accessToken: accessToken,
//     });

//     // Get the current time
//     const currentTime = new Date();

//     let hasMoreOrders = true;
//     let params: any = {
//       limit: 250,
//       created_at_min: lastSync.toISOString(),
//       created_at_max: currentTime.toISOString(),
//     };

//     while (hasMoreOrders) {
//       const orders = await shopify.order.list(params);

//       if (orders.length < params.limit) {
//         hasMoreOrders = false;
//       } else {
//         const lastOrder = orders[orders.length - 1];
//         params = { ...params, page_info: lastOrder.id };
//       }

//       for (const order of orders) {
//         // Calculate grossProfit and cogs for the order
//         const paid = parseFloat(order.total_price);
//         const tax = parseFloat(order.total_tax)
//         const cogs = (paid - tax) * 0.34;
//         const grossProfit = paid - cogs;

//         await prisma.order.create({
//           data: {
//             date: new Date(order.created_at),
//             orderId: order.order_number.toString(),
//             source: order.source_name,
//             customer: order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Unknown',
//             customerId: order.customer?.id.toString() || "",
//             fulfillmentStatus: order.fulfillment_status ? order.fulfillment_status : "Unfulfilled",
//             paid: paid,
//             tax: tax,
//             shippingCost: 0,
//             //@ts-ignore
//             shippingPaid: parseFloat(order.total_shipping_price_set.shop_money.amount),
//             shippingCountry: order.shipping_address?.country || "N/A",
//             shippingRegion: order.shipping_address?.province_code || "N/A",
//             discount: parseFloat(order.total_discounts || "0"),
//             grossProfit: grossProfit,
//             cogs: cogs,
//             storeId: shopId,
//             lineItems: {
//               create: order.line_items.map(item => {
//                 const itemPaid = parseFloat(item.price) * item.quantity;
//                 const preTaxGrossProfit = itemPaid * 0.66;
//                 const productCost = itemPaid - preTaxGrossProfit;
//                 return {
//                   lineItemId: item.id.toString(),
//                   productId: item.product_id?.toString() || "",
//                   variantId: item.variant_id?.toString() || "",
//                   name: item.variant_title || item.title,
//                   quantity: item.quantity,
//                   paid: itemPaid,
//                   discount: parseFloat(item.total_discount),
//                   productCost: productCost,
//                   preTaxGrossProfit: preTaxGrossProfit,
//                   preTaxGrossMargin: 66
//                 };
//               })
//             }
//           }
//         });
//       }
//     }

//     // Update lastSync time in the database to current time
//     await prisma.store.update({
//       where: { id: shopId },
//       data: { lastSync: currentTime },
//     });

//     res.status(200).send('Orders synchronized successfully');
//   } catch (error) {
//     console.error('Error syncing orders:', error);
//     res.status(500).send('Internal Server Error');
//   }
// });



// router.post('/sync-products', async (req: Request, res: Response) => {
//   const { shopId } = req.body;

//   if (!shopId) {
//     return res.status(400).send('Missing required parameter: shopId');
//   }

//   try {
//     // Fetch store information from the database using shopId
//     const store = await prisma.store.findUnique({
//       where: { id: shopId },
//     });

//     if (!store) {
//       return res.status(404).send('Store not found');
//     }

//     // Initialize Shopify API client
//     const shopify = new Shopify({
//       shopName: store.shopifyName,
//       accessToken: store.accessToken,
//     });

//     const currentTime = new Date();

//     let hasMoreProducts = true;
//     let params: any = { 
//       limit: 250,
//       updated_at_max: store.lastSync.toISOString()
//     };

//     while (hasMoreProducts) {
//       const products = await shopify.product.list(params);

//       if (products.length < params.limit) {
//         hasMoreProducts = false;
//       } else {
//         const lastProduct = products[products.length - 1];
//         params = { ...params, since_id: lastProduct.id };
//       }

//       // Sync products and variants to the database
//       for (const product of products) {
//         const createdProduct = await prisma.product.upsert({
//           where: { productId: product.id.toString() },
//           update: {
//             title: product.title,
//             storeId: shopId,
//           },
//           create: {
//             productId: product.id.toString(),
//             title: product.title,
//             storeId: shopId,
//           },
//         });

//         // Sync variants
//         for (const variant of product.variants) {
//           await prisma.variant.upsert({
//             where: { variantId: variant.id.toString() },
//             update: {
//               title: variant.title,
//               price: parseFloat(variant.price),
//               inventoryQuantity: variant.inventory_quantity,
//               productId: createdProduct.id,
//             },
//             create: {
//               variantId: variant.id.toString(),
//               title: variant.title,
//               price: parseFloat(variant.price),
//               inventoryQuantity: variant.inventory_quantity,
//               productId: createdProduct.id,
//             },
//           });
//         }
//       }
//     }

//     res.status(200).send('Products synchronized successfully');
//   } catch (error) {
//     console.error('Error syncing products:', error);
//     res.status(500).send('Internal Server Error');
//   }
// });

// router.post('/resync-products', async (req: Request, res: Response) => {
//   const { shopId } = req.body;

//   if (!shopId) {
//     return res.status(400).send('Missing required parameter: shopId');
//   }

//   try {
//     // Fetch store information from the database using shopId
//     const store = await prisma.store.findUnique({
//       where: { id: shopId },
//     });

//     if (!store) {
//       return res.status(404).send('Store not found');
//     }

//     const { shopifyName: shopName, accessToken, lastSync } = store;
//     const shopify = new Shopify({
//       shopName: shopName,
//       accessToken: accessToken,
//     });

//     // Get the current time
//     const currentTime = new Date();

//     let hasMoreProducts = true;
//     let params: any = {
//       limit: 250,
//       updated_at_min: lastSync.toISOString(),
//       updated_at_max: currentTime.toISOString(),
//     };

//     while (hasMoreProducts) {
//       const products = await shopify.product.list(params);

//       if (products.length < params.limit) {
//         hasMoreProducts = false;
//       } else {
//         const lastProduct = products[products.length - 1];
//         params = { ...params, since_id: lastProduct.id };
//       }

//       for (const product of products) {
//         const createdProduct = await prisma.product.upsert({
//           where: { productId: product.id.toString() },
//           update: {
//             title: product.title,
//             storeId: shopId,
//           },
//           create: {
//             productId: product.id.toString(),
//             title: product.title,
//             storeId: shopId,
//           },
//         });

//         for (const variant of product.variants) {
//           await prisma.variant.upsert({
//             where: { variantId: variant.id.toString() },
//             update: {
//               title: variant.title,
//               price: parseFloat(variant.price),
//               inventoryQuantity: variant.inventory_quantity,
//               productId: createdProduct.id,
//             },
//             create: {
//               variantId: variant.id.toString(),
//               title: variant.title,
//               price: parseFloat(variant.price),
//               inventoryQuantity: variant.inventory_quantity,
//               productId: createdProduct.id,
//             },
//           });
//         }
//       }
//     }

//     res.status(200).send('Products synchronized successfully');
//   } catch (error) {
//     console.error('Error syncing products:', error);
//     res.status(500).send('Internal Server Error');
//   }
// })

  
router.post('/fetch-orders', fetchOrders);

router.post('/fetch-products', fetchProducts);


// router.post('/sync-metrics', async (req: Request, res: Response) => {
//   const { shopId } = req.body;
//   if (!shopId) {
//     return res.status(400).send('Missing required parameter: shopId');
//   }

//   try {
//     const orders = await prisma.order.findMany({
//       where: { storeId: shopId },
//       include: { lineItems: true },
//     });

//     const endDate = new Date();
//     const startDate = subYears(endDate, 5);
//     const timePeriod = getDatesInInterval(startDate, endDate);

//     const totalSalesValues = timePeriod.map((date) => {
//       let totalSales = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate) {
//           totalSales += order.paid;
//         }
//       });
//       return totalSales;
//     });

//     const taxesValues = timePeriod.map((date) => {
//       let totalSales = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate) {
//           totalSales += order.tax || 0;
//         }
//       });
//       return totalSales;
//     });

//     const netSalesValues = totalSalesValues.map((v, i) => v - taxesValues[i]);

//     const cogsValues = timePeriod.map((date) => {
//       let totalSales = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate) {
//           totalSales += order.cogs;
//         }
//       });
//       return totalSales;
//     });

//     const grossProfitValues = netSalesValues.map((v, i) => v - cogsValues[i]);

//     const grossProfitMarginValues = grossProfitValues.map((v, i) =>
//       netSalesValues[i] ? (v / netSalesValues[i]) * 100 : 0
//     );

//     const cogsMarginValues = cogsValues.map((v, i) => (netSalesValues[i] ? (v / netSalesValues[i]) * 100 : 0));

//     const ordersValues = timePeriod.map((date) => {
//       let number = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate) {
//           number++;
//         }
//       });
//       return number;
//     });

//     // Fetch existing customer order histories
//     const existingCustomers = await prisma.customerOrderHistory.findMany({
//       where: { shopId },
//     });

//     const customerOrderHistory = existingCustomers.reduce((acc, customer) => {
//       acc[customer.customerId] = customer.orderDates;
//       return acc;
//     }, {} as { [key: string]: Date[] });

//     // Update customer order histories
//     for (const order of orders) {
//       const { customerId, date } = order;
//       if (customerId) {
//         if (!customerOrderHistory[customerId]) {
//           customerOrderHistory[customerId] = [];
//         }
//         customerOrderHistory[customerId].push(date);
//       }
//     }

//     // Save updated customer order histories
//     for (const [customerId, orderDates] of Object.entries(customerOrderHistory)) {
//       await prisma.customerOrderHistory.upsert({
//         where: {
//           customerId_shopId: { customerId, shopId },
//         },
//         update: {
//           orderDates,
//         },
//         create: {
//           customerId,
//           shopId,
//           orderDates,
//         },
//       });
//     }

//     const firstOrderDates: any = {};
//     orders.forEach((order) => {
//       const orderDate = order.date.toISOString().split('T')[0];
//       const customerId = order.customerId;
//       if (customerId && (!firstOrderDates[customerId] || new Date(firstOrderDates[customerId]) > new Date(orderDate))) {
//         firstOrderDates[customerId] = orderDate;
//       }
//     });

//     const newCustomerCountValues = timePeriod.map((date) => {
//       const dateStr = date.toISOString().split('T')[0];
//       let newCustomerCount = 0;
//       for (const firstOrderDate of Object.values(firstOrderDates)) {
//         if (firstOrderDate === dateStr) {
//           newCustomerCount++;
//         }
//       }
//       return newCustomerCount;
//     });

//     const repeatCustomerCountValues = timePeriod.map((date) => {
//       const dateStr = date.toISOString().split('T')[0];
//       let repeatCustomerCount = 0;
//       for (const [customerId, orderDates] of Object.entries(customerOrderHistory)) {
//         if (orderDates.length > 1 && orderDates.some((d) => d.toISOString().split('T')[0] === dateStr)) {
//           repeatCustomerCount++;
//         }
//       }
//       return repeatCustomerCount;
//     });

//     let totalAov = 0;
//     let aovNums = 0;
//     const aovValues = timePeriod.map((date) => {
//       let totalSales = 0;
//       let numberOfOrders = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate) {
//           totalSales += order.paid;
//           numberOfOrders++;
//         }
//       });
//       if (numberOfOrders) {
//         totalAov += totalSales / numberOfOrders;
//         aovNums++;
//       }
//       return totalSales / numberOfOrders || 0;
//     });

//     let totalAnoi = 0;
//     let anoiNums = 0;
//     const anoiValues = timePeriod.map((date) => {
//       let numberOfItems = 0;
//       let numberOfOrders = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate) {
//           numberOfItems += order.lineItems.reduce((a, i) => a + i.quantity, 0);
//           numberOfOrders++;
//         }
//       });
//       if (numberOfOrders) {
//         totalAnoi += numberOfItems / numberOfOrders;
//         anoiNums++;
//       }
//       return numberOfItems / numberOfOrders || 0;
//     });

//     const newCustomers = {}; // Store new customer IDs and their first order date
//     orders.forEach(order => {
//       //@ts-ignore
//       if (!newCustomers[order.customerId]) {
//         //@ts-ignore
//         newCustomers[order.customerId] = order.date;
//       }
//     });

//     const newCustomerSalesValues = timePeriod.map(date => {
//       let totalSales = 0;
//       orders.forEach(order => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         //@ts-ignore
//         if (date.toISOString().split('T')[0] === orderDate && newCustomers[order.customerId] === order.date) {
//           totalSales += (order.paid - order.tax);
//         }
//       });
//       return totalSales;
//     });

//     const newCustomerAovValues = timePeriod.map(date => {
//       let totalSales = 0;
//       let numberOfOrders = 0;
//       orders.forEach(order => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         //@ts-ignore
//         if (date.toISOString().split('T')[0] === orderDate && newCustomers[order.customerId] === order.date) {
//           totalSales += order.paid;
//           numberOfOrders++;
//         }
//       });
//       return totalSales / numberOfOrders || 0;
//     });

//     const repeatCustomers = Object.keys(customerOrderHistory).filter(customerId => customerOrderHistory[customerId].length > 1);

//     const repeatCustomerSalesValues = timePeriod.map(date => {
//       let totalSales = 0;
//       orders.forEach(order => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate && repeatCustomers.includes(order.customerId)) {
//           totalSales += order.paid - order.tax;
//         }
//       });
//       return totalSales;
//     });

//     const repeatCustomerAovValues = timePeriod.map(date => {
//       let totalSales = 0;
//       let numberOfOrders = 0;
//       orders.forEach(order => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate && repeatCustomers.includes(order.customerId)) {
//           totalSales += order.paid;
//           numberOfOrders++;
//         }
//       });
//       return totalSales / numberOfOrders || 0;
//     });

//     const newCustomerOrderCountValues = timePeriod.map((date) => {
//       const dateStr = date.toISOString().split('T')[0];
//       let newCustomerOrderCount = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         //@ts-ignore
//         if (orderDate === dateStr && newCustomers[order.customerId] === order.date) {
//           newCustomerOrderCount++;
//         }
//       });
//       return newCustomerOrderCount;
//     });

//     const totalCustomerValues = timePeriod.map((date) => {
//       const uniqueCustomers = new Set();
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0]
//           if (date.toISOString().split('T')[0] === orderDate) {
//               uniqueCustomers.add(order.customerId); // Add customer ID to the set
//           }
//       });
//       return uniqueCustomers.size; // Return the number of unique customers
//     });

//     const metricsData = [
//       {
//         name: 'Total Sales',
//         description: 'Equates to gross sales - discounts - returns + taxes + shipping charges.',
//         values: totalSalesValues,
//       },
//       {
//         name: 'Taxes',
//         description: 'The total amount of taxes charged on orders during this period.',
//         values: taxesValues,
//       },
//       {
//         name: 'Net Sales',
//         description: 'Equates to gross sales + shipping - taxes - discounts - returns.',
//         values: netSalesValues,
//       },
//       {
//         name: 'COGS',
//         description: 'Equates to Product Costs + Shipping Costs + Fulfillment Costs + Packing Fees + Transaction Fees',
//         values: cogsValues,
//       },
//       {
//         name: 'Gross Profit',
//         description: 'Calculated by subtracting Cost of Goods (COGS) from Net Sales.',
//         values: grossProfitValues,
//       },
//       {
//         name: 'Gross Profit %',
//         description: 'Gross Profit as a % of Net Sales',
//         values: grossProfitMarginValues,
//       },
//       {
//         name: 'COGS %',
//         description: 'Cost of Goods (COGS) as % of Net Sales',
//         values: cogsMarginValues,
//       },
//       {
//         name: 'Orders',
//         description: 'Number of orders',
//         values: ordersValues,
//       },
//       {
//         name: 'New Customer Orders',
//         description: 'Number of orders from new customers',
//         values: newCustomerOrderCountValues
//       },
//       {
//         name: 'New Customers',
//         description: 'The number of first-time buyers during a specific period.',
//         values: newCustomerCountValues,
//       },
//       {
//         name: 'Repeat Customers',
//         description: 'Customers who have made more than one purchase in their order history.',
//         values: repeatCustomerCountValues,
//       },
//       {
//         name: 'New Customer Sales',
//         description: 'Net Sales generated from new customers during this time period.',
//         values: newCustomerSalesValues
//       },
//       {
//         name: "Repeat Customer Sales", 
//         description: "Net Sales generated from existing customers during this time period.",
//         values: repeatCustomerSalesValues
//       },
//       {
//         name: "New Customer AOV", 
//         description: "Average Value of Each Order from a New Customer. Total New Customer Sales / Number of New Customers.",
//         values: newCustomerAovValues
//       },
//       {
//         name: "Repeat Customer AOV", 
//         description: "Average Value of Each Order from a Repeat Customer. Total Repeat Customer Sales / Number of Repeat Customers.",
//         values: repeatCustomerAovValues
//       },
//       {
//         name: 'AOV',
//         description: 'Average Value of Each Order Total Sales / Orders',
//         values: aovValues,
//       },
//       {
//         name: 'Average No Of Items',
//         description: 'The average number of items per order. | Total Items Ordered / Total Orders.',
//         values: anoiValues,
//       },
//       {
//         name: "Total Customers", 
//         description: "The total number of unique customers who have made a purchase.",
//         values: totalCustomerValues
//       }
//     ];

//     for (const metric of metricsData) {
//       for (let i = 0; i < timePeriod.length; i++) {
//         if(metric.values[i]){
//           await prisma.metric.upsert({
//             where: {
//               shopId_date_metricType: {
//                 shopId,
//                 date: timePeriod[i],
//                 metricType: metric.name,
//               },
//             },
//             update: {
//               value: metric.values[i],
//               description: metric.description,
//             },
//             create: {
//               shopId,
//               date: timePeriod[i],
//               metricType: metric.name,
//               value: metric.values[i],
//               description: metric.description,
//             },
//           });
//         }
//       }
//     }

//     res.status(200).json({
//       message: "metrics synced successfully"
//     });
//   } catch (e) {
//     console.error('Error exporting metric data:', e);
//     res.status(500).send('Internal Server Error');
//   }
// })

// router.post('/resync-metrics', async (req: Request, res: Response) => {
//   const { shopId } = req.body;
//   if (!shopId) {
//     return res.status(400).send('Missing required parameter: shopId');
//   }

//   try {

//     const store = await prisma.store.findUnique({
//       where: { id: shopId },
//     });

//     if (!store) {
//       return res.status(404).send('Store not found');
//     }

//     const { lastSync } = store;

//     const orders = await prisma.order.findMany({
//       where: {
//         storeId: shopId,
//         date: {
//           gte: lastSync,
//         },
//       },
//       include: { lineItems: true },
//     });

//     const endDate = new Date();
//     const timePeriod = getDatesInInterval(lastSync, endDate);

//     const totalSalesValues = timePeriod.map((date) => {
//       let totalSales = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate) {
//           totalSales += order.paid;
//         }
//       });
//       return totalSales;
//     });

//     const taxesValues = timePeriod.map((date) => {
//       let totalSales = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate) {
//           totalSales += order.tax || 0;
//         }
//       });
//       return totalSales;
//     });

//     const netSalesValues = totalSalesValues.map((v, i) => v - taxesValues[i]);

//     const cogsValues = timePeriod.map((date) => {
//       let totalSales = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate) {
//           totalSales += order.cogs;
//         }
//       });
//       return totalSales;
//     });

//     const grossProfitValues = netSalesValues.map((v, i) => v - cogsValues[i]);

//     const grossProfitMarginValues = grossProfitValues.map((v, i) =>
//       netSalesValues[i] ? (v / netSalesValues[i]) * 100 : 0
//     );

//     const cogsMarginValues = cogsValues.map((v, i) => (netSalesValues[i] ? (v / netSalesValues[i]) * 100 : 0));

//     const ordersValues = timePeriod.map((date) => {
//       let number = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate) {
//           number++;
//         }
//       });
//       return number;
//     });

//     // Fetch existing customer order histories
//     const existingCustomers = await prisma.customerOrderHistory.findMany({
//       where: { shopId },
//     });

//     const customerOrderHistory = existingCustomers.reduce((acc, customer) => {
//       acc[customer.customerId] = customer.orderDates;
//       return acc;
//     }, {} as { [key: string]: Date[] });

//     // Update customer order histories
//     for (const order of orders) {
//       const { customerId, date } = order;
//       if (customerId) {
//         if (!customerOrderHistory[customerId]) {
//           customerOrderHistory[customerId] = [];
//         }
//         customerOrderHistory[customerId].push(date);
//       }
//     }

//     // Save updated customer order histories
//     for (const [customerId, orderDates] of Object.entries(customerOrderHistory)) {
//       await prisma.customerOrderHistory.upsert({
//         where: {
//           customerId_shopId: { customerId, shopId },
//         },
//         update: {
//           orderDates,
//         },
//         create: {
//           customerId,
//           shopId,
//           orderDates,
//         },
//       });
//     }

//     const firstOrderDates: any = {};
//     orders.forEach((order) => {
//       const orderDate = order.date.toISOString().split('T')[0];
//       const customerId = order.customerId;
//       if (customerId && (!firstOrderDates[customerId] || new Date(firstOrderDates[customerId]) > new Date(orderDate))) {
//         firstOrderDates[customerId] = orderDate;
//       }
//     });

//     const newCustomerCountValues = timePeriod.map((date) => {
//       const dateStr = date.toISOString().split('T')[0];
//       let newCustomerCount = 0;
//       for (const firstOrderDate of Object.values(firstOrderDates)) {
//         if (firstOrderDate === dateStr) {
//           newCustomerCount++;
//         }
//       }
//       return newCustomerCount;
//     });

//     const repeatCustomerCountValues = timePeriod.map((date) => {
//       const dateStr = date.toISOString().split('T')[0];
//       let repeatCustomerCount = 0;
//       for (const [customerId, orderDates] of Object.entries(customerOrderHistory)) {
//         if (orderDates.length > 1 && orderDates.some((d) => d.toISOString().split('T')[0] === dateStr)) {
//           repeatCustomerCount++;
//         }
//       }
//       return repeatCustomerCount;
//     });

//     let totalAov = 0;
//     let aovNums = 0;
//     const aovValues = timePeriod.map((date) => {
//       let totalSales = 0;
//       let numberOfOrders = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate) {
//           totalSales += order.paid;
//           numberOfOrders++;
//         }
//       });
//       if (numberOfOrders) {
//         totalAov += totalSales / numberOfOrders;
//         aovNums++;
//       }
//       return totalSales / numberOfOrders || 0;
//     });

//     let totalAnoi = 0;
//     let anoiNums = 0;
//     const anoiValues = timePeriod.map((date) => {
//       let numberOfItems = 0;
//       let numberOfOrders = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate) {
//           numberOfItems += order.lineItems.reduce((a, i) => a + i.quantity, 0);
//           numberOfOrders++;
//         }
//       });
//       if (numberOfOrders) {
//         totalAnoi += numberOfItems / numberOfOrders;
//         anoiNums++;
//       }
//       return numberOfItems / numberOfOrders || 0;
//     });

//     const newCustomers = {}; // Store new customer IDs and their first order date
//     orders.forEach(order => {
//       //@ts-ignore
//       if (!newCustomers[order.customerId]) {
//         //@ts-ignore
//         newCustomers[order.customerId] = order.date;
//       }
//     });

//     const newCustomerSalesValues = timePeriod.map(date => {
//       let totalSales = 0;
//       orders.forEach(order => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         //@ts-ignore
//         if (date.toISOString().split('T')[0] === orderDate && newCustomers[order.customerId] === order.date) {
//           totalSales += (order.paid - order.tax);
//         }
//       });
//       return totalSales;
//     });

//     const newCustomerAovValues = timePeriod.map(date => {
//       let totalSales = 0;
//       let numberOfOrders = 0;
//       orders.forEach(order => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         //@ts-ignore
//         if (date.toISOString().split('T')[0] === orderDate && newCustomers[order.customerId] === order.date) {
//           totalSales += order.paid;
//           numberOfOrders++;
//         }
//       });
//       return totalSales / numberOfOrders || 0;
//     });

//     const repeatCustomers = Object.keys(customerOrderHistory).filter(customerId => customerOrderHistory[customerId].length > 1);

//     const repeatCustomerSalesValues = timePeriod.map(date => {
//       let totalSales = 0;
//       orders.forEach(order => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate && repeatCustomers.includes(order.customerId)) {
//           totalSales += order.paid - order.tax;
//         }
//       });
//       return totalSales;
//     });

//     const repeatCustomerAovValues = timePeriod.map(date => {
//       let totalSales = 0;
//       let numberOfOrders = 0;
//       orders.forEach(order => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         if (date.toISOString().split('T')[0] === orderDate && repeatCustomers.includes(order.customerId)) {
//           totalSales += order.paid;
//           numberOfOrders++;
//         }
//       });
//       return totalSales / numberOfOrders || 0;
//     });

//     const newCustomerOrderCountValues = timePeriod.map((date) => {
//       const dateStr = date.toISOString().split('T')[0];
//       let newCustomerOrderCount = 0;
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0];
//         //@ts-ignore
//         if (orderDate === dateStr && newCustomers[order.customerId] === order.date) {
//           newCustomerOrderCount++;
//         }
//       });
//       return newCustomerOrderCount;
//     });

//     const totalCustomerValues = timePeriod.map((date) => {
//       const uniqueCustomers = new Set();
//       orders.forEach((order) => {
//         const orderDate = order.date.toISOString().split('T')[0]
//           if (date.toISOString().split('T')[0] === orderDate) {
//               uniqueCustomers.add(order.customerId); // Add customer ID to the set
//           }
//       });
//       return uniqueCustomers.size; // Return the number of unique customers
//     });

//     const metricsData = [
//       {
//         name: 'Total Sales',
//         description: 'Equates to gross sales - discounts - returns + taxes + shipping charges.',
//         values: totalSalesValues,
//       },
//       {
//         name: 'Taxes',
//         description: 'The total amount of taxes charged on orders during this period.',
//         values: taxesValues,
//       },
//       {
//         name: 'Net Sales',
//         description: 'Equates to gross sales + shipping - taxes - discounts - returns.',
//         values: netSalesValues,
//       },
//       {
//         name: 'COGS',
//         description: 'Equates to Product Costs + Shipping Costs + Fulfillment Costs + Packing Fees + Transaction Fees',
//         values: cogsValues,
//       },
//       {
//         name: 'Gross Profit',
//         description: 'Calculated by subtracting Cost of Goods (COGS) from Net Sales.',
//         values: grossProfitValues,
//       },
//       {
//         name: 'Gross Profit %',
//         description: 'Gross Profit as a % of Net Sales',
//         values: grossProfitMarginValues,
//       },
//       {
//         name: 'COGS %',
//         description: 'Cost of Goods (COGS) as % of Net Sales',
//         values: cogsMarginValues,
//       },
//       {
//         name: 'Orders',
//         description: 'Number of orders',
//         values: ordersValues,
//       },
//       {
//         name: 'New Customer Orders',
//         description: 'Number of orders from new customers',
//         values: newCustomerOrderCountValues
//       },
//       {
//         name: 'New Customers',
//         description: 'The number of first-time buyers during a specific period.',
//         values: newCustomerCountValues,
//       },
//       {
//         name: 'Repeat Customers',
//         description: 'Customers who have made more than one purchase in their order history.',
//         values: repeatCustomerCountValues,
//       },
//       {
//         name: 'New Customer Sales',
//         description: 'Net Sales generated from new customers during this time period.',
//         values: newCustomerSalesValues
//       },
//       {
//         name: "Repeat Customer Sales", 
//         description: "Net Sales generated from existing customers during this time period.",
//         values: repeatCustomerSalesValues
//       },
//       {
//         name: "New Customer AOV", 
//         description: "Average Value of Each Order from a New Customer. Total New Customer Sales / Number of New Customers.",
//         values: newCustomerAovValues
//       },
//       {
//         name: "Repeat Customer AOV", 
//         description: "Average Value of Each Order from a Repeat Customer. Total Repeat Customer Sales / Number of Repeat Customers.",
//         values: repeatCustomerAovValues
//       },
//       {
//         name: 'AOV',
//         description: 'Average Value of Each Order Total Sales / Orders',
//         values: aovValues,
//       },
//       {
//         name: 'Average No Of Items',
//         description: 'The average number of items per order. | Total Items Ordered / Total Orders.',
//         values: anoiValues,
//       },
//       {
//         name: "Total Customers", 
//         description: "The total number of unique customers who have made a purchase.",
//         values: totalCustomerValues
//       }
//     ];

//     for (const metric of metricsData) {
//       for (let i = 0; i < timePeriod.length; i++) {
//         if(metric.values[i]){
//           await prisma.metric.upsert({
//             where: {
//               shopId_date_metricType: {
//                 shopId,
//                 date: timePeriod[i],
//                 metricType: metric.name,
//               },
//             },
//             update: {
//               value: metric.values[i],
//               description: metric.description,
//             },
//             create: {
//               shopId,
//               date: timePeriod[i],
//               metricType: metric.name,
//               value: metric.values[i],
//               description: metric.description,
//             },
//           });
//         }
//       }
//     }

//     res.status(200).json({
//       message: "metrics resynced successfully",
//       syncTime: new Date()
//     });
//   } catch (e) {
//     console.error('Error exporting metric data:', e);
//     res.status(500).send('Internal Server Error');
//   }
// });


router.post('/fetch-metrics', fetchMetrics);

router.post('/fetch-finance-metrics', fetchFinanceMetrics)


router.post('/spotlight', fetchSpotlightData);

router.use('/facebook', facebookRoutes)


// router.post('/old-metrics', async(req: Request, res: Response) => {
//   const { shopId } = req.body;
//   if (!shopId) {
//     return res.status(400).send('Missing required parameter: shopId');
//   }

//   try {
//     const orders = await prisma.order.findMany({
//       where: { storeId: shopId },
//       include: { lineItems: true },
//     })

//     const timePeriod = getDatesInMonth(2024 , 5)
//     const labels = timePeriod.map( (date) => format(date, "dd MM"))

//     const totalSalesValues = timePeriod.map( (date) => {
//       let totalSales = 0
//       orders.forEach((order) => {
//           const orderDate = new Date(order.date).toDateString()
//           if(date.toDateString() === orderDate) {
//               totalSales += order.paid
//           }
//       })
//       return totalSales
//     })

//     const taxesValues = timePeriod.map( (date) => {
//       let totalSales = 0
//       orders.forEach((order) => {
//           const orderDate = new Date(order.date).toDateString()
//           if(date.toDateString() === orderDate) {
//               totalSales += order.tax
//           }
//       })
//       return totalSales
//     })

//     const netSalesValues = totalSalesValues.map( (v,i) => v - taxesValues[i])
    
//     const cogsValues = timePeriod.map( (date) => {
//       let totalSales = 0
//       orders.forEach((order) => {
//           const orderDate = new Date(order.date).toDateString()
//           if(date.toDateString() === orderDate) {
//               totalSales += order.cogs
//           }
//       })
//       return totalSales
//     })

//     const cogsMarginValues = cogsValues.map( (v,i) => { return (v/netSalesValues[i])*100 ? (v/netSalesValues[i])*100 : 0 })

//     const grossProfitValues = netSalesValues.map( (v,i) => v - cogsValues[i])

//     const grossProfitMarginValues = grossProfitValues.map( (v,i) => { return (v/netSalesValues[i])*100 ? (v/netSalesValues[i])*100 : 0})

//     const ordersValues = timePeriod.map( (date) => {
//       let number = 0
//       orders.forEach((order) => {
//           const orderDate = new Date(order.date).toDateString()
//           if(date.toDateString() === orderDate) {
//               number ++
//           }
//       })
//       return number
//     })

//     const firstOrderDates:any = {};
//     orders.forEach((order) => {
//       const orderDate = new Date(order.date).toDateString();
//       const customerId = order.customerId;
//       if (customerId && (!firstOrderDates[customerId] || new Date(firstOrderDates[customerId]) > new Date(orderDate))) {
//         firstOrderDates[customerId] = orderDate;
//       }
//     })

//     // Calculate new customers per day
//     const newCustomerCountvalues = timePeriod.map((date) => {
//       const dateStr = date.toDateString();
//       let newCustomerCount = 0;
//       for (const firstOrderDate of Object.values(firstOrderDates)) {
//         if (firstOrderDate === dateStr) {
//           newCustomerCount++;
//         }
//       }
//       return newCustomerCount;
//     })

//     const orderCounts:any = {};
//     orders.forEach((order) => {
//       const orderDate = new Date(order.date).toDateString();
//       const customerId = order.customerId;
//       if (customerId) {
//         if (!orderCounts[customerId]) {
//           orderCounts[customerId] = [];
//         }
//         orderCounts[customerId].push(orderDate);
//       }
//     });

//     // Calculate repeat customers per day
//     const repeatCustomerCountValues = timePeriod.map((date) => {
//       const dateStr = date.toDateString();
//       let repeatCustomerCount = 0;
//       for (const dates of Object.values(orderCounts)) {
//         //@ts-ignore
//         if (dates.length > 1 && dates.includes(dateStr) && dates[0] !== dateStr) {
//           repeatCustomerCount++;
//         }
//       }
//       return repeatCustomerCount;
//     })

//     let totalAov = 0
//     let aovNums = 0
//     const aovValues = timePeriod.map( (date) => {
//       let totalSales = 0
//       let numberOfOrders = 0
//       orders.forEach((order) => {
//           const orderDate = new Date(order.date).toDateString()
//           if(date.toDateString() === orderDate) {
//               totalSales += order.paid
//               numberOfOrders++
//           }
//       })
//       if(numberOfOrders) {
//         totalAov += totalSales/numberOfOrders
//         aovNums++
//       }
//       return totalSales/numberOfOrders || 0
//     })

//     let totalAnoi = 0
//     let anoiNums = 0
//     const anoiValues = timePeriod.map( (date) => {
//       let numberOfItems = 0
//       let numberOfOrders = 0
//       orders.forEach((order) => {
//           const orderDate = new Date(order.date).toDateString()
//           if(date.toDateString() === orderDate) {
//               numberOfItems += order.lineItems.reduce( (a, i) => a + i.quantity, 0)
//               numberOfOrders++
//           }
//       })
//       if(numberOfOrders) {
//         totalAnoi += numberOfItems/numberOfOrders
//         anoiNums++
//       }
//       return numberOfItems/numberOfOrders || 0
//     })

//     const metrics = [
//       {
//         name: "Total Sales",
//         description: "Equates to gross sales - discounts - returns + taxes + shipping charges.",
//         values: totalSalesValues,
//         total: `₹ ${totalSalesValues.reduce((s, c) => s + c, 0).toFixed(2)}`
//       },
//       {
//         name: "Taxes", 
//         description: "The total amount of taxes charged on orders during this period.",
//         values: taxesValues,
//         total: `₹ ${taxesValues.reduce((s, c) => s + c, 0).toFixed(2)}`
//       },
//       {
//         name: "Net Sales", 
//         description: "Equates to gross sales + shipping - taxes - discounts - returns.",
//         values: netSalesValues,
//         total: `₹ ${netSalesValues.reduce((s, c) => s + c, 0).toFixed(2)}`
//       },
//       {
//         name: "COGS", 
//         description: "Equates to Product Costs + Shipping Costs + Fulfillment Costs + Packing Fees + Transaction Fees",
//         values: cogsValues,
//         total: `₹ ${cogsValues.reduce((s, c) => s + c, 0).toFixed(2)}`
//       },
//       {
//         name: "COGS %", 
//         description: "Cost of Goods (COGS) as % of Net Sales",
//         values: cogsMarginValues,
//         total: `34%`
//       },
//       {
//         name: "Gross Profit", 
//         description: "Calculated by subtracting Cost of Goods (COGS) from Net Sales.",
//         values: grossProfitValues,
//         total: `₹ ${grossProfitValues.reduce((s, c) => s + c, 0).toFixed(2)}`
//       },
//       {
//         name: "Gross Profit %", 
//         description: "Gross Profit as a % of Net Sales",
//         values: grossProfitMarginValues,
//         total: '66%'
//       },
//       {
//         name: "Orders", 
//         description: "Number of orders",
//         values: ordersValues,
//         total: `${ordersValues.reduce((s, c) => s + c, 0)}`
//       },
//       {
//         name: "New Customers", 
//         description: "The number of first-time buyers during a specific period.",
//         values: newCustomerCountvalues,
//         total: `${newCustomerCountvalues.reduce((s, c) => s + c, 0)}`
//       },
//       {
//         name: "Repeat Customers", 
//         description: "Customers who have made more than one purchase in their order history.",
//         values: repeatCustomerCountValues,
//         total: `${repeatCustomerCountValues.reduce((s, c) => s + c, 0)}`
//       },
//       {
//         name: "AOV", 
//         description: "Average Value of Each Order Total Sales / Orders",
//         values: aovValues,
//         total: `${(totalAov/aovNums).toFixed(2)}`
//       },
//       {
//         name: "Average No Of Items", 
//         description: "The average number of items per order. | Total Items Ordered / Total Orders.",
//         values: anoiValues,
//         total: `${totalAnoi/anoiNums}`
//       }

//     ]

//     res.status(200).json({
//       metrics,
//       labels
//     })
  
//   } catch (e) {
//     console.error('Error exporting metric data:', e);
//     res.status(500).send('Internal Server Error');
//   }

// })
  

export default router;