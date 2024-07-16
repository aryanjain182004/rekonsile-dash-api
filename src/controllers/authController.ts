import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { validationResult } from 'express-validator';

const prisma = new PrismaClient();

const signup = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { firstName, lastName, email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const newUser = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        password: hashedPassword,
        verified: true,  // Marking user as verified
      },
    })

    const token = jwt.sign({ userId: newUser.id }, process.env.JWT_SECRET!, { expiresIn: process.env.JWT_EXPIRES_IN });

    const userDetails = {
      id: newUser.id,
      email: newUser.email,
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      displayName: `${newUser.firstName} ${newUser.lastName}`,
      verified: newUser.verified
    }
    
    res.status(201).json({ 
      message: 'User registered successfully.' ,
      accessToken: token,
      user: userDetails
    });
  } catch (error) {
    console.log(error)
    res.status(500).json({ error: 'User registration failed.' });
  }
};

const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const userDetails = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: `${user.firstName} ${user.lastName}`,
      verified: user.verified
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: process.env.JWT_EXPIRES_IN });

    res.json({
      accessToken: token,
      user: userDetails
    });
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Login failed.' });
  }
};

const me = async (req: any, res: Response) => {
  const userId = req.user.userId
  try {
    const user = await prisma.user.findUnique({ 
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        verified: true,
      },
      where: { id: userId}
    })
    if (!user) {
      return res.status(401).json({ error: 'Token expired or invalid'})
    }

    const userDetails = { ...user, displayName: `${user.firstName} ${user.lastName}`,}

    res.json({
      user: userDetails
    })

  } catch(error) {
    res.status(500).json({ error: 'Server failed'})
  }
}

export { signup, login, me };

