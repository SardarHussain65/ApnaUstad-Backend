// src/routes/promoRoute.ts
import { Router } from "express";
import { validatePromoCode } from "../controllers/promoController";
import { jwtAuthMiddleware } from "../middlewares/jwt.middleware";

const router = Router();

/**
 * All routes require JWT authentication
 */
router.use(jwtAuthMiddleware);

/**
 * @description Validate a promo code against a booking amount
 * @access Private (User)
 */
router.post("/validate", validatePromoCode);

export default router;
