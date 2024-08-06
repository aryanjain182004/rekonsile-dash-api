import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { validationResult } from 'express-validator';
import axios from 'axios';
// import speakeasy from "speakeasy";
const speakeasy = require("speakeasy");

const prisma = new PrismaClient();

const signup = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { firstName, lastName, email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const secret = speakeasy.generateSecret({ length: 20 }).base32;
    const newUser = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        password: hashedPassword,
        totpSecret: secret,
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

const sendEmail = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    // Extract data from the request body
    const { email, firstName } = req.body;
    const capitalizedName = firstName.charAt(0).toUpperCase() + firstName.slice(1);
    const user = await prisma.user.findUnique({
      where: {
        email,
      },
      select: {
        totpSecret: true,
      }
    })
    const otp = speakeasy.totp({
      secret: user?.totpSecret!,
      encoding: "base32",
    });

    const msgHTML = `
    <div style="font-family: Helvetica,Arial,sans-serif;min-width:1000px;overflow:auto;line-height:2">
      <div style="margin:50px auto;width:70%;padding:20px 0">
        <div style="border-bottom:1px solid #eee">
          <a href="" style="font-size:1.4em;color: #00466a;text-decoration:none;font-weight:600">Rekonsile</a>
        </div>
        <p style="font-size:1.1em">Hi, ${capitalizedName}</p>
        <p>Thank you for choosing Rekonsile. Use the following OTP to complete your Sign Up procedures. OTP is valid for 5 minutes</p>
        <h2 style="background: #00466a;margin: 0 auto;width: max-content;padding: 0 10px;color: #fff;border-radius: 4px;">${otp}</h2>
        <p style="font-size:0.9em;">Regards,<br />Rekonsile</p>
        <hr style="border:none;border-top:1px solid #eee" />
        <div style="float:right;padding:8px 0;color:#aaa;font-size:0.8em;line-height:1;font-weight:300">
          <p>Rekonsile</p>
          <p>Bangalore</p>
        </div>
      </div>
    </div>`;

    // Send email with OTP
    await axios.post(
      `${process.env.NEXT_PUBLIC_OTP_URL}?uname=${
        process.env.NEXT_PUBLIC_OTP_NAME
      }&pass=${process.env.NEXT_PUBLIC_OTP_PASSWORD}&fromEmail=${
        process.env.NEXT_PUBLIC_OTP_FROM_EMAIL
      }&toEmail=${email}&fromName=Rekonsile&subject=Your%20One-Time%20Password%20(OTP)%20for%20Account%20Verification&msgPlain=Dear ${firstName},&msgHTML=${encodeURIComponent(
        msgHTML
      )}`
    );

    // Send response back to the client
    res.status(200).json({
      message: "Email sent successfully",
    });
  } catch (error: any) {
    console.error(error)
    res.status(500).json({ error: 'Server failed'})
  }
};

const verifyOtp = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    // Extract data from the request body
    const { email, otp } = req.body;

    const user = await prisma.user.findUnique({
      where: {
        email: email,
      },
      select: {
        totpSecret: true,
        firstName: true,
      },
    })

    if (user && user.totpSecret) {
      // Use speakeasy to verify TOTP
      const valid = speakeasy.totp.verify({
        secret: user.totpSecret,
        encoding: "base32",
        token: otp,
        window: 60,
      });
      if (valid) {
        await prisma.user.update({
          where: {
            email: email,
          },
          data: {
            verified: true,
          },
        });

        const formattedMsgHTML = `
            <div style="font-family: Helvetica,Arial,sans-serif;min-width:1000px;overflow:auto;line-height:2">
              <div style="margin:50px auto;width:70%;padding:20px 0">
                <div style="border-bottom:1px solid #eee">
                  <a href="" style="font-size:1.4em;color: #00466a;text-decoration:none;font-weight:600">Rekonsile</a>
                </div>
                <p style="font-size:1.1em">Hi, ${user?.firstName}</p>
                <p>Welcome to Reconsile. Hope you are doing well. You have successfully verified your OTP.</p>
                <p style="font-size:0.9em;">Regards,<br />Rekonsile</p>
                <hr style="border:none;border-top:1px solid #eee" />
              <div style="float:right;padding:8px 0;color:#aaa;font-size:0.8em;line-height:1;font-weight:300">
              <p>Rekonsile</p>
              <p>Bangalore</p>
            </div>
          </div>
        </div>`;

        await axios.post(
          `${process.env.NEXT_PUBLIC_OTP_URL}?uname=${
            process.env.NEXT_PUBLIC_OTP_NAME
          }&pass=${process.env.NEXT_PUBLIC_OTP_PASSWORD}&fromEmail=${
            process.env.NEXT_PUBLIC_OTP_FROM_EMAIL
          }&toEmail=${email}&fromName=Rekonsile&subject=Welcome%20to%20Rekonsile&msgPlain=Dear Rekonsile,&msgHTML=${encodeURIComponent(
            formattedMsgHTML
          )}`
        );

        res.status(200).json({
          status: "OTP is valid",
        })
      } else {
        res.status(400).json({
          status: "OTP is invalid",
        })
      }

    } else {
      res.status(400).json({
        status: "error while getting user",
      })
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Server failed'})
  }
};



export { signup, login, me, sendEmail, verifyOtp };

