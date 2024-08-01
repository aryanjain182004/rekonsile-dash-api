import { PrismaClient } from "@prisma/client"
import bcrypt from 'bcryptjs';
import { Response } from "express"

const prisma = new PrismaClient()

export const updatePassword = async (req: any, res: Response) => {
  const userId = req.user.userId
  const {oldPass, newPass} = req.body

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(401).json({ error: 'Not authorized' });
    }

    const isPasswordValid = await bcrypt.compare(oldPass, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid password.' });
    }

    const hashedPassword = await bcrypt.hash(newPass, 10);

    await prisma.user.update({
        where: {
            id: userId
        },
        data: {
            password: hashedPassword
        }
    })
  
    const userDetails = { ...user, displayName: `${user.firstName} ${user.lastName}`,}

    const {password, ...resUserDetails} = userDetails
  
    res.status(201).json({
      message: "password udpated successfully",
      user: resUserDetails
    })
  
  } catch(error) {
    res.status(500).json({ error: 'Server failed'})
  }
}

export const updateUserDetails = async (req: any, res: Response) => {
    const userId = req.user.userId
    const {firstName, lastName} = req.body
  
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
  
      if (!user) {
        return res.status(401).json({ error: 'Not authorized' });
      }
  
      await prisma.user.update({
          where: {
            id: userId
          },
          data: {
            firstName,
            lastName
          }
      })
    
      const userDetails = { ...user, displayName: `${firstName} ${lastName}`, firstName, lastName}
  
      const {password, ...resUserDetails} = userDetails
    
      res.status(201).json({
        message: "User details udpated successfully",
        user: resUserDetails
      })
    
    } catch(error) {
      res.status(500).json({ error: 'Server failed'})
    }
  }