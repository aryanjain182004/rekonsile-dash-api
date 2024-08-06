import { Router } from 'express';
import { check } from 'express-validator';
import { signup, login, me, sendEmail, verifyOtp } from '../controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.post('/register', [
  check('firstName', 'firstName is required').not().isEmpty(),
  check('lastName', 'lastName is required').not().isEmpty(),
  check('email', 'Please include a valid email').isEmail(),
  check('password', 'Password must be at least 6 characters long').isLength({ min: 6 }),
], signup);

router.post('/login', login);

router.get('/me', authMiddleware, me)

router.post('/sendEmail', sendEmail)

router.post('/verifyOtp', verifyOtp)

export default router;

