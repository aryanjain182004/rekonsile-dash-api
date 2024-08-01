import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { updatePassword, updateUserDetails } from '../controllers/userController';

const router = Router();

router.post('/update-password', authMiddleware, updatePassword)

router.post('/update-user-details', authMiddleware, updateUserDetails)


export default router