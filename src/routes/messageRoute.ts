import { Router } from "express";
import { jwtAuthMiddleware } from "../middlewares/jwt.middleware";
import { getBookingMessages, markAsRead } from "../controllers/messageController";

const router = Router();

// Get chat history for a booking
router.get("/:bookingId", jwtAuthMiddleware, getBookingMessages);

// Mark as read
router.patch("/:bookingId/read", jwtAuthMiddleware, markAsRead);

export default router;
