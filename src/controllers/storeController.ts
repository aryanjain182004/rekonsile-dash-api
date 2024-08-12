import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { resyncStoreData, syncStoreData } from '../utils/sync';
import { eachDayOfInterval, format } from 'date-fns';
import { ExportedLineItem, ExportedOrder, ExportOrdersRequest } from '../types/orders';

const prisma = new PrismaClient();

export const createStore = async (req: any, res: Response) => {
    const userId = req.user.userId;
    const { name, accessToken, shopifyName } = req.body;

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
        });

        res.status(201).json({
            message: `${name} store created successfully`,
            storeId: newStore.id,
        });
    } catch (error) {
        console.error('Error creating store:', error); 
        res.status(500).json({
            error: "Failed to create store",
        });
    }
};

export const updateAccessToken = async (req: Request, res: Response) => {
    const { shopifyName, accessToken, storeId } = req.body;

    try {
        await prisma.store.update({
            where: { id: storeId },
            data: { accessToken, shopifyName },
        });

        res.status(200).json({
            message: `Store access token updated successfully`,
        });
    } catch (error) {
        console.error('Error updating access token:', error); 
        res.status(500).json({
            error: "Failed to update store access token",
        });
    }
};

export const updateGeneralSettings = async (req: Request, res: Response) => {
    const { name, storeUrl, industry, storeId } = req.body;

    try {
        await prisma.store.update({
            where: { id: storeId },
            data: { name, storeUrl, industry },
        });

        res.status(200).json({
            message: `General settings updated successfully`,
        });
    } catch (error) {
        console.error('Error updating general settings:', error); 
        res.status(500).json({
            error: "Failed to update general settings",
        });
    }
};

export const getStores = async (req: any, res: Response) => {
    const userId = req.user.userId;

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
            },
        });

        const resStores = stores.map(store => {
            const synced = (store.shopifyName && store.accessToken) ? true : false;
            const { accessToken, shopifyName, ...storeDetails } = store;
            return { ...storeDetails, synced };
        });

        res.status(200).json({
            stores: resStores,
        });
    } catch (error) {
        console.error('Error fetching stores:', error); 
        res.status(500).json({
            error: "Failed to fetch stores",
        });
    }
};

export const checkStoreSync = async (req: Request, res: Response) => {
    const { storeId } = req.body;

    try {
        const store = await prisma.store.findUnique({
            where: { id: storeId },
            select: {
                shopifyName: true,
                accessToken: true,
            },
        });

        if (!store) {
            return res.status(404).json({ error: "Store not found" });
        }

        const { shopifyName, accessToken } = store;
        const synced = Boolean(shopifyName && accessToken);

        res.status(200).json({ synced });
    } catch (error) {
        console.error('Error checking store sync data:', error);
        res.status(500).json({ error: "Failed to check store sync data" });
    }
};

export const syncStore = async (req: any, res: Response) => {
    const { storeId } = req.body;

    try {
        await prisma.store.update({
            where: { id: storeId },
            data: { syncing: true },
        });

        syncStoreData(storeId, prisma);

        res.status(200).json({ message: "Store data is syncing" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to sync store data" });
    }
};

export const resyncStore = async (req: any, res: Response) => {
    const { storeId } = req.body;

    try {
        const currentTime = new Date();

        await prisma.store.update({
            where: { id: storeId },
            data: { syncing: true },
        });

        resyncStoreData(storeId, prisma, currentTime);

        res.status(200).json({
            message: "Store data is syncing",
            syncTime: currentTime,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to sync store data" });
    }
};

export const disconnectShopify = async (req: any, res: Response) => {
    const { storeId } = req.body;

    try {
        await prisma.$transaction(async (prisma) => {
            // Update store details
            await prisma.store.update({
                where: { id: storeId },
                data: { shopifyName: "", accessToken: "" },
            });

            // Delete metrics
            await prisma.metric.deleteMany({
                where: { shopId: storeId },
            });

            // Delete line items and orders
            await prisma.lineItem.deleteMany({
                where: { order: { storeId: storeId } },
            });

            await prisma.order.deleteMany({
                where: { storeId: storeId },
            });

            // Delete variants and products
            await prisma.variant.deleteMany({
                where: { product: { storeId: storeId } },
            });

            await prisma.product.deleteMany({
                where: { storeId: storeId },
            });
        });

        res.status(200).json({ message: "Disconnected from Shopify successfully" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to disconnect from Shopify" });
    }
};

export const fetchDashboardMetrics = async (req: any, res: Response) => {
    const { shopId, startDate, endDate } = req.body;

    if (!shopId || !startDate || !endDate) {
        return res.status(400).send('Missing required parameters: shopId, startDate, or endDate');
    }

    try {
        const start = new Date(startDate);
        const end = new Date(endDate);

        const store = await prisma.store.findUnique({
            where: { id: shopId },
            select: { currency: true },
        });

        const currency = store?.currency.split(" ")[0] || "";

        const metrics = await prisma.metric.findMany({
            where: {
                shopId,
                date: {
                    gte: start,
                    lte: end,
                },
            },
            orderBy: { date: 'asc' },
        });

        const labels: string[] = eachDayOfInterval({ start, end }).map(date => format(date, 'd MMM'));
        const metricsData: { [key: string]: any } = {};

        const metricTypes = [
            { name: "Total Sales", description: "Equates to gross sales - discounts - returns + taxes + shipping charges.", prefix: `${currency}`, suffix: "" },
            { name: 'Taxes', description: 'The total amount of taxes charged on orders during this period.', prefix: `${currency}`, suffix: "" },
            { name: 'Net Sales', description: 'Equates to gross sales + shipping - taxes - discounts - returns.', prefix: `${currency}`, suffix: "" },
            { name: 'Orders', description: 'Number of orders', prefix: "", suffix: "" },
            { name: "Gross Profit", description: "Calculated by subtracting Cost of Goods (COGS) and marketing costs from Net Sales.", prefix: `${currency}`, suffix: "" },
            { name: "Purchase Revenue", description: "Income generated from the sale of goods, calculated by multiplying the number of units sold by the price per unit", prefix: `${currency}`, suffix: "" }
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

        metrics.forEach(metric => {
            const dateStr = format(new Date(metric.date.toISOString().split('T')[0]), 'd MMM');
            const dateIndex = labels.indexOf(dateStr);

            if (!metricsData[metric.metricType]) {
                console.error(`Unexpected metricType: ${metric.metricType}`);
            } else {
                metricsData[metric.metricType].values[dateIndex] = metric.value;
                metricsData[metric.metricType].total += metric.value;
            }
        });

        const response = Object.values(metricsData).map((metric: any) => {
            if (metric.name === "Gross Profit") {
                metric.name = "Net Profit";
            }
            metric.total = metric.total.toFixed(2);
            metric.values = metric.values.map((v: any) => parseFloat(v.toFixed(2)));
            return metric;
        });

        res.status(200).json({ metrics: response, labels });
    } catch (error) {
        console.error('Error fetching metric data:', error);
        res.status(500).send('Internal Server Error');
    }
};

export const fetchGoals = async (req: any, res: Response) => {
    const { storeId } = req.body;

    try {
        const store = await prisma.store.findUnique({
            where: { id: storeId },
            select: { netSalesGoal: true, adSpendGoal: true },
        });

        res.status(200).json({ store });
    } catch (error) {
        console.error("Error fetching goals:", error);
        res.status(500).send('Failed to fetch goals');
    }
};

export const updateAdsGoal = async (req: any, res: Response) => {
    const { goal, storeId } = req.body;

    try {
        await prisma.store.update({
            where: { id: storeId },
            data: { adSpendGoal: goal },
        });

        res.status(201).json({
            store: { adSpendGoal: goal },
        });
    } catch (error) {
        console.error("Error updating goals:", error);
        res.status(500).send('Failed to update goals');
    }
};

export const updateNetSalesGoal = async (req: any, res: Response) => {
    const { goal, storeId } = req.body;

    try {
        await prisma.store.update({
            where: { id: storeId },
            data: { netSalesGoal: goal },
        });

        res.status(201).json({
            store: { netSalesGoal: goal },
        });
    } catch (error) {
        console.error("Error updating goals:", error);
        res.status(500).send('Failed to update goals');
    }
};

export const fetchOrders = async (req: Request, res: Response) => {
    const { shopId, startDate, endDate }: ExportOrdersRequest = req.body;

    if (!shopId || !startDate || !endDate) {
        return res.status(400).send('Missing required parameters: shopId, startDate, or endDate');
    }

    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

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
                orderId: order.orderId,
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
        });

        res.status(200).json(exportedOrders);
    } catch (error) {
        console.error('Error exporting orders:', error);
        res.status(500).send('Internal Server Error');
    }
};

export const fetchProducts = async (req: Request, res: Response) => {
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
            revenue: parseFloat(variantRevenue.toFixed(2)),
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
          revenue: parseFloat(revenue.toFixed(2)),
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
};

export const fetchMetrics = async (req: Request, res: Response) => {
  const { shopId, startDate, endDate } = req.body;

  if (!shopId || !startDate || !endDate) {
    return res.status(400).send('Missing required parameters: shopId, startDate, or endDate');
  }

  try {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const store = await prisma.store.findUnique({
      where: { id: shopId },
      select: { currency: true },
    });

    const currency = store?.currency.split(" ")[0] || "";

    const metrics = await prisma.metric.findMany({
      where: { shopId, date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    });

    const labels = eachDayOfInterval({ start, end }).map(date => format(date, 'd MMM'));
    const metricsData: { [key: string]: any } = {};

    const metricTypes = [
      { name: "Total Sales", description: "Gross sales - discounts - returns + taxes + shipping charges.", prefix: `${currency}`, suffix: "" },
      { name: "Taxes", description: "Total amount of taxes charged on orders during this period.", prefix: `${currency}`, suffix: "" },
      { name: "Net Sales", description: "Gross sales + shipping - taxes - discounts - returns.", prefix: `${currency}`, suffix: "" },
      { name: "COGS", description: "Product Costs + Shipping Costs + Fulfillment Costs + Packing Fees + Transaction Fees", prefix: `${currency}`, suffix: "" },
      { name: "COGS %", description: "COGS as % of Net Sales", prefix: "", suffix: "%" },
      { name: "Gross Profit", description: "Calculated by subtracting COGS from Net Sales.", prefix: `${currency}`, suffix: "" },
      { name: "Gross Profit %", description: "Gross Profit as a % of Net Sales", prefix: "", suffix: "%" },
      { name: "Orders", description: "Number of orders", prefix: "", suffix: "" },
      { name: 'New Customer Orders', description: 'Number of orders from new customers', prefix: "", suffix: "" },
      { name: "New Customers", description: "Number of first-time buyers during the period.", prefix: "", suffix: "" },
      { name: "Repeat Customers", description: "Customers who have made more than one purchase.", prefix: "", suffix: "" },
      { name: "New Customer Sales", description: "Net Sales from new customers.", prefix: `${currency}`, suffix: "" },
      { name: "Repeat Customer Sales", description: "Net Sales from existing customers.", prefix: `${currency}`, suffix: "" },
      { name: "New Customer AOV", description: "Average Value of Each Order from a New Customer.", prefix: `${currency}`, suffix: "" },
      { name: "Repeat Customer AOV", description: "Average Value of Each Order from a Repeat Customer.", prefix: `${currency}`, suffix: "" },
      { name: "AOV", description: "Average Value of Each Order", prefix: `${currency}`, suffix: "" },
      { name: "Average No Of Items", description: "Average number of items per order.", prefix: "", suffix: "" },
      { name: "Total Customers", description: "Total number of unique customers who made a purchase.", prefix: "", suffix: "" }
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

    let gpCount = 0;
    let cogsCount = 0;
    let totalOrders = 0;
    let totalAOVSum = 0;
    let totalNewAOVSum = 0;
    let totalRepeatAOVSum = 0;
    let totalANOISum = 0;
    let totalNewCustomerOrders = 0;

    metrics.forEach(metric => {
      const dateStr = format(new Date(metric.date.toISOString().split('T')[0]), 'd MMM');
      const dateIndex = labels.indexOf(dateStr);

      if (dateIndex === -1) {
        console.error(`Date ${dateStr} not found in labels`);
        return;
      }

      if (!metricsData[metric.metricType]) {
        console.error(`Unexpected metricType: ${metric.metricType}`);
        return;
      }

      metricsData[metric.metricType].values[dateIndex] = metric.value;

    });

    metrics.forEach(metric => {
      const dateStr = format(new Date(metric.date.toISOString().split('T')[0]), 'd MMM');
      const dateIndex = labels.indexOf(dateStr);

      if (dateIndex === -1) {
        console.error(`Date ${dateStr} not found in labels`);
        return;
      }

      if (!metricsData[metric.metricType]) {
        console.error(`Unexpected metricType: ${metric.metricType}`);
        return;
      }

      switch (metric.metricType) {
        case "Gross Profit %":
          if (metric.value) {
            metricsData[metric.metricType].total += metric.value;
            gpCount++;
          }
          break;
        case "COGS %":
          if (metric.value) {
            metricsData[metric.metricType].total += metric.value;
            cogsCount++;
          }
          break;
        case "AOV":
          if (metric.value) {
            totalAOVSum += metric.value * metricsData["Orders"].values[dateIndex];
          }
          break;
        case "New Customer AOV":
          if (metric.value) {
            totalNewAOVSum += (metric.value * metricsData["New Customer Orders"].values[dateIndex]);
          }
          break;
        case "Repeat Customer AOV":
          if (metric.value) {
            totalRepeatAOVSum += metric.value * (metricsData["Orders"].values[dateIndex] - metricsData["New Customer Orders"].values[dateIndex]);
          }
          break;
        case "Average No Of Items":
          if (metric.value) {
            totalANOISum += metric.value * metricsData["Orders"].values[dateIndex];
          }
          break;
        case "Orders":
          totalOrders += metric.value;
          metricsData[metric.metricType].total += metric.value;
          break;
        case "New Customer Orders":
          totalNewCustomerOrders += metric.value;
          metricsData[metric.metricType].total += metric.value;
          break;
        default:
          metricsData[metric.metricType].total += metric.value;
      }
    })

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
      metricsData["New Customer AOV"].total = totalNewAOVSum / totalNewCustomerOrders;
    }

    const response = Object.values(metricsData).map((metric: any) => {
      metric.total = metric.total.toFixed(2);
      metric.values = metric.values.map((v: any) => parseFloat(v.toFixed(2)));
      return metric;
    });

    res.status(200).json({ metrics: response, labels });
  } catch (e) {
    console.error('Error fetching metric data:', e);
    res.status(500).send('Internal Server Error');
  }
};

export const fetchFinanceMetrics =  async (req: Request, res: Response) => {
    const { shopId, startDate, endDate } = req.body;
  
    if (!shopId || !startDate || !endDate) {
      return res.status(400).send('Missing required parameters: shopId, startDate, or endDate');
    }
  
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
  
      const store = await prisma.store.findUnique({
        where: { id: shopId },
        select: { currency: true },
      });
  
      const currency = store?.currency.split(" ")[0] || "";
  
      const metrics = await prisma.metric.findMany({
        where: { shopId, date: { gte: start, lte: end } },
        orderBy: { date: 'asc' },
      });
  
      const labels = eachDayOfInterval({ start, end }).map(date => format(date, 'MM-dd-yyyy'));
      const metricsData: { [key: string]: any } = {};
  
      let gpCount = 0;
  
      const metricTypes = [
        { name: "Total Sales", description: "Equates to gross sales - discounts - returns + taxes + shipping charges.", prefix: currency, suffix: "" },
        { name: "COGS", description: "Equates to Product Costs + Shipping Costs + Fulfillment Costs + Packing Fees + Transaction Fees", prefix: currency, suffix: "" },
        { name: "Gross Profit", description: "Calculated by subtracting Cost of Goods (COGS) and marketing costs from Net Sales.", prefix: currency, suffix: "" },
        { name: "Gross Profit %", description: "Net Profit as a % of Net Sales", prefix: "", suffix: "%" },
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
        const dateStr = format(new Date(metric.date.toISOString().split('T')[0]), 'MM-dd-yyyy');
        const dateIndex = labels.indexOf(dateStr);
  
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
      });
  
      if (gpCount > 0) {
        metricsData["Gross Profit %"].total /= gpCount;
      }
  
      const response = Object.values(metricsData).map((metric: any) => {
        if (metric.name === "Gross Profit") {
          metric.name = "Net Profit";
        }
        if (metric.name === "Gross Profit %") {
          metric.name = "Net Profit %";
        }
        metric.total = metric.total.toFixed(2);
        metric.values = metric.values.map((v: any) => parseFloat(v.toFixed(2)));
        return metric;
      });
  
      res.status(200).json({ metrics: response, labels });
  
    } catch (e) {
      console.error('Error fetching metric data:', e);
      res.status(500).send('Internal Server Error');
    }
};

export const fetchSpotlightData = async (req: Request, res: Response) => {
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
        });
      }
  
      // Calculate biggestMover, bestSeller, and topCustomer
      const productSales = new Map<string, { amount: number; quantity: number }>();
      const customerSpending = new Map<string, number>();
  
      orders.forEach((order) => {
        if (order.customer) {
          customerSpending.set(order.customer, (customerSpending.get(order.customer) || 0) + order.paid);
        }
  
        order.lineItems.forEach((item) => {
          const productStats = productSales.get(item.productId) || { amount: 0, quantity: 0 };
          productStats.amount += item.paid;
          productStats.quantity += item.quantity;
          productSales.set(item.productId, productStats);
        });
      });
  
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
          productId: biggestMover.name,
        },
      }))?.title || "";
  
      bestSeller.name = (await prisma.product.findUnique({
        where: {
          storeId: shopId,
          productId: bestSeller.name,
        },
      }))?.title || "";
  
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
};
