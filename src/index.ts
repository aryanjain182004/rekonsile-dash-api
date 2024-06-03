import express from 'express';
import authRoutes from './routes/auth';
import { authMiddleware } from './middleware/authMiddleware';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req, res) => {
    res.json({
        message: "server healthy"
    })
})

app.use('/auth', authRoutes);

app.get('/protected', authMiddleware, (req, res) => {
  res.send('This is a protected route.');
})

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
})
