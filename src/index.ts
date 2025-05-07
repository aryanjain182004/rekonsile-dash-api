import express from 'express'
import authRoutes from './routes/auth'
import storeRoutes from './routes/store'
import shopifyRoutes from './routes/shopify'
import userRoutes from './routes/user'
import { authMiddleware } from './middleware/authMiddleware';
import cors from 'cors'
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json())

app.use(cors({
  origin: 'http://localhost:8083',
  credentials: true
}))

app.get('/', (req, res) => {
    res.json({
        message: "server healthy"
    })
})

app.use('/api/auth', authRoutes)

app.use('/api/store', storeRoutes)

app.use('/api/shopify', shopifyRoutes)

app.use('/api/user', userRoutes)

app.get('/protected', authMiddleware, (req, res) => {
  res.send('This is a protected route.');
})

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
})
