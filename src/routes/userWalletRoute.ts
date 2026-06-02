import { Router } from "express";
import { jwtAuthMiddleware } from "../middlewares/jwt.middleware";
import { getMyUserWallet } from "../controllers/userWalletController";

const router = Router();

// Protect all routes with user JWT authentication
router.use(jwtAuthMiddleware);

/**
 * @description Get my customer wallet balance & transactions ledger
 * @access Private (User)
 */
router.get("/my", getMyUserWallet);

export default router;
