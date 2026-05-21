import { Router } from "express";
import { jwtAuthMiddleware } from "../middlewares/jwt.middleware";
import { getMyPayments } from "../controllers/paymentController";

const router = Router();

router.get('/my-payments', jwtAuthMiddleware, getMyPayments);

export default router;
