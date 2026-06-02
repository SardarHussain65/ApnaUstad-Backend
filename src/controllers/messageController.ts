import { NextFunction, Response } from "express";
import { AuthRequest } from "../middlewares/jwt.middleware";
import Message from "../models/Message";
import Booking from "../models/Booking";
import logger from "../config/logger";
import { UploadRequest } from "../middlewares/multer.middleware";
import { getIO } from "../sockets/socketManager";

const isCommunicationLocked = (status: string) => status === "completed" || status === "cancelled";
const isTrustedAudioUrl = (value: string) => {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.pathname.includes("/messages/audio/");
    } catch {
        return false;
    }
};

export const ensureActiveBookingCommunication = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { bookingId } = req.params;
        const userId = req.tokenPayload?.id;
        const booking = await Booking.findById(bookingId);

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found" });
        }
        if (booking.customer.toString() !== userId && booking.worker.toString() !== userId) {
            return res.status(403).json({ success: false, message: "Forbidden: You are not part of this booking" });
        }
        if (isCommunicationLocked(booking.status)) {
            return res.status(409).json({ success: false, message: "Chat is closed because this booking has ended" });
        }

        return next();
    } catch (error) {
        logger.error("Error in ensureActiveBookingCommunication:", error);
        return res.status(500).json({ success: false, message: "Could not verify chat access" });
    }
};

/**
 * @description Upload a voice message attachment for an active booking
 * @route POST /api/v1/messages/:bookingId/upload-audio
 */
export const uploadChatAudio = async (req: AuthRequest & UploadRequest, res: Response) => {
    try {
        const { bookingId } = req.params;
        const userId = req.tokenPayload?.id;
        const booking = await Booking.findById(bookingId);

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found" });
        }
        if (booking.customer.toString() !== userId && booking.worker.toString() !== userId) {
            return res.status(403).json({ success: false, message: "Forbidden: You are not part of this booking" });
        }
        if (isCommunicationLocked(booking.status)) {
            return res.status(409).json({ success: false, message: "Chat is closed because this booking has ended" });
        }

        const audioUrl = req.uploadedAudioUrls?.[0];
        if (!audioUrl) {
            return res.status(400).json({ success: false, message: "Voice message audio is required" });
        }

        return res.status(201).json({ success: true, data: { audioUrl } });
    } catch (error) {
        logger.error("Error in uploadChatAudio:", error);
        return res.status(500).json({ success: false, message: "Voice message upload failed" });
    }
};

/**
 * @description Get chat history for a specific booking
 * @route GET /api/v1/messages/:bookingId
 * @access Private (User/Worker)
 */
export const getBookingMessages = async (req: AuthRequest, res: Response) => {
    try {
        const { bookingId } = req.params;
        const userId = req.tokenPayload?.id;

        // Verify booking ownership/participation
        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found" });
        }

        if (booking.customer.toString() !== userId && booking.worker.toString() !== userId) {
            return res.status(403).json({ success: false, message: "Forbidden: You are not part of this booking" });
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;

        const messages = await Message.find({ booking: bookingId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Message.countDocuments({ booking: bookingId });

        res.status(200).json({
            success: true,
            data: messages.reverse(), // Return in chronological order
            communicationLocked: isCommunicationLocked(booking.status),
            bookingStatus: booking.status,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error: any) {
        logger.error("Error in getBookingMessages:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Mark all messages in a booking as read
 * @route PATCH /api/v1/messages/:bookingId/read
 */
export const markAsRead = async (req: AuthRequest, res: Response) => {
    try {
        const { bookingId } = req.params;
        const userId = req.tokenPayload?.id;

        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found" });
        }

        if (booking.customer.toString() !== userId && booking.worker.toString() !== userId) {
            return res.status(403).json({ success: false, message: "Forbidden: You are not part of this booking" });
        }

        // Mark only messages sent by the OTHER person as read
        await Message.updateMany(
            { 
                booking: bookingId, 
                sender: { $ne: userId }, 
                readAt: null 
            },
            { $set: { readAt: new Date() } }
        );

        res.status(200).json({ success: true, message: "Messages marked as read" });
    } catch (error) {
        res.status(500).json({ success: false });
    }
};
/**
 * @description Send a message in a booking
 * @route POST /api/v1/messages/:bookingId
 */
export const sendMessage = async (req: AuthRequest, res: Response) => {
    try {
        const { bookingId } = req.params;
        const {
            message,
            messageType = "text",
            audioUrl: rawAudioUrl,
            audioDurationSeconds: rawAudioDurationSeconds,
        } = req.body;
        const userId = req.tokenPayload?.id;
        const userType = req.tokenPayload?.type;
        const audioUrl = typeof rawAudioUrl === "string" ? rawAudioUrl.trim() : "";
        const content = typeof message === "string" ? message.trim() : "";
        const isAudioMessage = messageType === "audio";
        const audioDurationSeconds = Math.min(120, Math.max(0, Number(rawAudioDurationSeconds || 0)));

        if (!["text", "audio"].includes(messageType)) {
            return res.status(400).json({ success: false, message: "Unsupported message type" });
        }
        if (!isAudioMessage && !content) {
            return res.status(400).json({ success: false, message: "Message content is required" });
        }
        if (isAudioMessage && !isTrustedAudioUrl(audioUrl)) {
            return res.status(400).json({ success: false, message: "Upload a valid voice message first" });
        }

        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found" });
        }

        // Verify participation
        const isCustomer = booking.customer.toString() === userId;
        const isWorker = booking.worker.toString() === userId;

        if (!isCustomer && !isWorker) {
            return res.status(403).json({ success: false, message: "Forbidden: You are not part of this booking" });
        }

        if (isCommunicationLocked(booking.status)) {
            return res.status(409).json({
                success: false,
                message: "Chat is closed because this booking has ended"
            });
        }

        const newMessage = await Message.create({
            booking: bookingId,
            sender: userId,
            senderModel: userType === 'user' ? 'User' : 'Worker',
            content: content || "Voice message",
            messageType,
            ...(isAudioMessage ? { audioUrl, audioDurationSeconds } : {}),
        });

        // Emit socket event for real-time update
        const io = getIO();
        io.to(`user:${booking.customer.toString()}`).emit('chat:receive', newMessage);
        io.to(`worker:${booking.worker.toString()}`).emit('chat:receive', newMessage);

        res.status(201).json({
            success: true,
            data: newMessage
        });
    } catch (error) {
        logger.error("Error in sendMessage:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};
