import express from 'express';
import authRoutes from './routes/auth';
import storeRoutes from './routes/store';
import shopifyRoutes from './routes/shopify';
import userRoutes from './routes/user';
import { authMiddleware } from './middleware/authMiddleware';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Define allowed origins
const allowedOrigins = [
  'http://localhost:8083', // For local development
  'https://rekonsilefrontend.vercel.app', // For production frontend
];

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., server-to-server requests)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    message: 'server healthy',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/user', userRoutes);

app.get('/protected', authMiddleware, (req, res) => {
  res.send('This is a protected route.');
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
