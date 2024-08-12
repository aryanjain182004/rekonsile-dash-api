import { Router } from "express";
import { Request, Response } from 'express';
import { CALLBACK_URL, FRONTEND_URL, SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_SCOPES } from "../config";
import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { syncStoreData } from "../utils/sync";
import { getInstallUrl, handleShopifyCallback } from "../controllers/shopifyController";

const router = Router()
const prisma = new PrismaClient()

router.get('/', getInstallUrl)

router.get('/callback', handleShopifyCallback)

export default router
  