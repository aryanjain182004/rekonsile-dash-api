import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { validationResult } from "express-validator";
import nodemailer from "nodemailer";
import speakeasy from "speakeasy";

const prisma = new PrismaClient();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const signup = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { firstName, lastName, email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  const totpSecret = speakeasy.generateSecret({ length: 20 }).base32;

  try {
    const newUser = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        password: hashedPassword,
        totpSecret,
        isOtpVerified: false,
      },
    });

    // Send OTP email
    await sendOtpEmail(email, totpSecret);

    const token = jwt.sign({ userId: newUser.id }, process.env.JWT_SECRET!, {
      expiresIn: process.env.JWT_EXPIRES_IN,
    });

    res.status(201).json({
      message:
        "User registered successfully. Please check your email for the OTP.",
      accessToken: token,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "User registration failed." });
  }
};

const sendOtpEmail = async (email: string, totpSecret: string) => {
  const token = speakeasy.totp({
    secret: totpSecret,
    encoding: "base32",
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Your OTP Code",
    text: `Your OTP code is ${token}`,
  };

  await transporter.sendMail(mailOptions);
};

const verifyOtp = async (req: Request, res: Response) => {
  const { email, otp } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const isVerified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: "base32",
      token: otp,
      window: 1,
    });

    if (!isVerified) {
      return res.status(400).json({ error: "Invalid OTP." });
    }

    await prisma.user.update({
      where: { email },
      data: { isOtpVerified: true },
    });

    res.json({ message: "OTP verified successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "OTP verification failed." });
  }
};

const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const userDetails = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: `${user.firstName} ${user.lastName}`,
      verified: user.verified,
    };

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, {
      expiresIn: process.env.JWT_EXPIRES_IN,
    });

    res.json({
      accessToken: token,
      user: userDetails,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login failed." });
  }
};

const me = async (req: any, res: Response) => {
  const userId = req.user.userId;
  try {
    const user = await prisma.user.findUnique({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        verified: true,
      },
      where: { id: userId },
    });
    if (!user) {
      return res.status(401).json({ error: "Token expired or invalid" });
    }

    const userDetails = {
      ...user,
      displayName: `${user.firstName} ${user.lastName}`,
    };

    res.json({
      user: userDetails,
    });
  } catch (error) {
    res.status(500).json({ error: "Server failed" });
  }
};

const sendOtp = async (req: Request, res: Response) => {
  const { email } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    await sendOtpEmail(email, user.totpSecret);

    res.json({ message: "OTP sent successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to send OTP." });
  }
};

export { signup, login, me, verifyOtp, sendOtp };
