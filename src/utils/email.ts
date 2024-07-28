import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "Gmail",
  // host: process.env.EMAIL_HOST,
  // port: Number(process.env.EMAIL_PORT),
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendVerificationEmail = async (email: string, token: string) => {
  // const url = `http://localhost:3000/auth/verify-email?token=${token}`;
  // await transporter.sendMail({
  //   from: process.env.EMAIL_USER,
  //   to: email,
  //   subject: 'Email Verification',
  //   html: `Click <a href="${url}">here</a> to verify your email.`,
  // });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Email Verification",
    text: `Your verification code is ${token}`,
  };

  // export { sendVerificationEmail };

  return transporter.sendMail(mailOptions);
};
