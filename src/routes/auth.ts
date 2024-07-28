import { Router } from "express";
import { check } from "express-validator";
import {
  signup,
  login,
  me,
  verifyOtp,
  sendOtp,
} from "../controllers/authController";
import { authMiddleware } from "../middleware/authMiddleware";

const router = Router();

router.post(
  "/register",
  [
    check("firstName", "firstName is required").not().isEmpty(),
    check("lastName", "lastName is required").not().isEmpty(),
    check("email", "Please include a valid email").isEmail(),
    check("password", "Password must be at least 6 characters long").isLength({
      min: 6,
    }),
  ],
  signup
);

router.post("/login", login);
router.post("/verifyOtp", verifyOtp);
router.post("/sendOtp", sendOtp);
// router.post("/verifyOtp", getOtpVerify);
// router.post("/sendEmail", getOtp);

router.get("/me", authMiddleware, me);

export default router;
