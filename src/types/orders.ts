export interface ExportOrdersRequest {
    shopId: string;
    startDate: string;
    endDate: string;
}

export interface ExportedOrder {
    date: string;
    orderId: string;
    customer: string;
    source: string;
    fulfillmentStatus: string;
    paid: number;
    shippingCost: number;
    shippingPaid: number;
    shippingCountry: string;
    shippingRegion: string;
    discount: number;
    cogs: number;
    grossProfit: number;
    products: ExportedLineItem[];
}

export interface ExportedLineItem {
    name: string;
    quantity: number;
    paid: number;
    discount: number;
    productCost: number;
    preTaxGrossProfit: number;
    preTaxGrossMargin: string;
}