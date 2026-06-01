// src/routes/disputeRoute.ts
import { Router } from "express";
import { raiseDispute, getMyDisputes } from "../controllers/disputeController";
import { jwtAuthMiddleware } from "../middlewares/jwt.middleware";

const router = Router();

/**
 * All routes require JWT authentication
 */
router.use(jwtAuthMiddleware);

/**
 * @description Raise a dispute for a booking
 * @access Private (User or Worker)
 */
router.post("/", raiseDispute);

/**
 * @description Get disputes involving the logged-in client or worker
 * @access Private (User or Worker)
 */
router.get("/my", getMyDisputes);

export default router;
