import { Request, Response } from 'express';
import { CALLBACK_URL, FRONTEND_URL, SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_SCOPES } from '../config';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { syncStoreData } from '../utils/sync';

const prisma = new PrismaClient();

export const getInstallUrl = (req: Request, res: Response) => {
    const { shop, storeId } = req.query;
  
    if (shop) {
      const state = Buffer.from(JSON.stringify({ storeId, shopifyName: shop })).toString('base64');
      const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SHOPIFY_SCOPES}&redirect_uri=${CALLBACK_URL}&state=${state}`;
      res.status(200).json({ url: installUrl });
    } else {
      res.status(400).send('Missing shop parameter');
    }
};

export const handleShopifyCallback = async (req: Request, res: Response) => {
  const { shop, hmac, code, state } = req.query;

  if (shop && hmac && code && state) {
    try {
      // Decode and parse state parameter
      const { storeId, shopifyName } = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));

      // Request access token from Shopify
      const accessTokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code
      });

      const accessToken = accessTokenResponse.data.access_token;

      // Update store record with access token and other details
      await prisma.store.update({
        where: { id: storeId },
        data: {
          accessToken,
          shopifyName,
          syncing: true,
        }
      });

      // Initiate data sync
      syncStoreData(storeId, prisma);

      // Redirect to frontend
      res.redirect(`${FRONTEND_URL}/dashboard/`);
    } catch (error) {
      console.error('Error handling Shopify callback:', error);
      res.status(500).send('Something went wrong while requesting the access token');
    }
  } else {
    res.status(400).send('Required parameters missing');
  }
};

  