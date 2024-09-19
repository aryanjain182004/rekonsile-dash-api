import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

export default router;