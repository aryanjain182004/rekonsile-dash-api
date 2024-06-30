import express from 'express';
import authRoutes from './routes/auth';
import sotreRoutes from './routes/store'
import { authMiddleware } from './middleware/authMiddleware';
import cors from 'cors'

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json())

app.use(cors())

app.get('/', (req, res) => {
    res.json({
        message: "server healthy"
    })
})

app.use('/api/auth', authRoutes)

app.use('/api/store', sotreRoutes)

app.get('/protected', authMiddleware, (req, res) => {
  res.send('This is a protected route.');
})

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
})
