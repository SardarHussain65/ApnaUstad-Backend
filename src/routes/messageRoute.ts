import { Router } from "express";
import { jwtAuthMiddleware } from "../middlewares/jwt.middleware";
import { ensureActiveBookingCommunication, getBookingMessages, markAsRead, sendMessage, uploadChatAudio } from "../controllers/messageController";
import { handleChatAudioUpload } from "../middlewares/multer.middleware";

const router = Router();

// Upload voice message media before sending the matching chat message
router.post("/:bookingId/upload-audio", jwtAuthMiddleware, ensureActiveBookingCommunication, handleChatAudioUpload, uploadChatAudio);

// Get chat history for a booking
router.get("/:bookingId", jwtAuthMiddleware, getBookingMessages);

// Mark as read
router.patch("/:bookingId/read", jwtAuthMiddleware, markAsRead);

// Send message
router.post("/:bookingId", jwtAuthMiddleware, sendMessage);

export default router;
