import { Router } from "express";
import { jwtAuthMiddleware } from "../middlewares/jwt.middleware";
import { getBookingMessages, markAsRead, sendMessage } from "../controllers/messageController";

const router = Router();

// Get chat history for a booking
router.get("/:bookingId", jwtAuthMiddleware, getBookingMessages);

// Mark as read
router.patch("/:bookingId/read", jwtAuthMiddleware, markAsRead);

// Send message
router.post("/:bookingId", jwtAuthMiddleware, sendMessage);

export default router;
