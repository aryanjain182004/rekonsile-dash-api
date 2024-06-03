import { Router } from 'express';
import { check } from 'express-validator';
import { signup, login } from '../controllers/authController';

const router = Router();

router.post('/signup', [
  check('name', 'Name is required').not().isEmpty(),
  check('email', 'Please include a valid email').isEmail(),
  check('password', 'Password must be at least 6 characters long').isLength({ min: 6 }),
], signup);

router.post('/login', login);

export default router;

