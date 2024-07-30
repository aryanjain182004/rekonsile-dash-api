import { Router } from "express";
import { Request, Response } from 'express';
import { CALLBACK_URL, FRONTEND_URL, SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_SCOPES } from "../config";
import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { syncStoreData } from "../controllers/syncController";

const router = Router()
const prisma = new PrismaClient()

router.get('/', (req:Request, res:Response) => {
    const { shop, storeId } = req.query;
    if (shop) {
      const state = Buffer.from(JSON.stringify({ storeId, shopifyName:shop })).toString('base64');
      const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SHOPIFY_SCOPES}&redirect_uri=${CALLBACK_URL}&state=${state}`;
      res.status(200).json({
        url: installUrl
      });
    } else {
      res.status(400).send('Missing shop parameter');
    }
})

router.get('/callback', async (req: Request, res: Response) => {
    const { shop, hmac, code, state } = req.query;

    if (shop && hmac && code && state) {
      //@ts-ignore
      const { storeId, shopifyName } = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
      try {
        const accessTokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
          client_id: SHOPIFY_API_KEY,
          client_secret: SHOPIFY_API_SECRET,
          code
        });
  
        const accessToken = accessTokenResponse.data.access_token;

        await prisma.store.update({
            data: {
                accessToken,
                shopifyName,
                syncing: true,
            },
            where: {
                id: storeId
            }
        })
        
        syncStoreData(storeId, prisma)
        // Redirect the user to the Next.js frontend
        res.redirect(`${FRONTEND_URL}/dashboard/store`);
      } catch (error) {
        console.error(error);
        res.status(500).send('Something went wrong while requesting the access token');
      }
    } else {
      res.status(400).send('Required parameters missing');
    }
})

export default router
  