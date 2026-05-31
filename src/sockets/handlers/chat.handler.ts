import { Server, Socket } from 'socket.io';
import Message from '../../models/Message';
import Booking from '../../models/Booking';
import logger from '../../config/logger';

export const registerChatHandlers = (io: Server, socket: Socket) => {
    socket.on('chat:send', async (data) => {
        try {
            const {
                bookingId,
                content,
                messageType = 'text',
                audioUrl,
                audioDurationSeconds,
            } = data;
            const senderId = (socket as any).user.id;
            const senderType = (socket as any).user.type; // 'user' or 'worker'
            const isAudioMessage = messageType === 'audio';
            const normalizedContent = typeof content === 'string' ? content.trim() : '';

            if (!bookingId || !['text', 'audio'].includes(messageType) || (!isAudioMessage && !normalizedContent)) {
                return socket.emit('chat:error', { message: "Invalid chat data" });
            }
            if (isAudioMessage && (typeof audioUrl !== 'string' || !audioUrl.startsWith('https://') || !audioUrl.includes('/messages/audio/'))) {
                return socket.emit('chat:error', { message: "Upload a valid voice message first" });
            }

            // Verify booking participation
            const booking = await Booking.findById(bookingId);
            if (!booking) {
                return socket.emit('chat:error', { message: "Booking not found" });
            }

            const isCustomer = booking.customer.toString() === senderId;
            const isWorker = booking.worker.toString() === senderId;

            if (!isCustomer && !isWorker) {
                return socket.emit('chat:error', { message: "Unauthorized to chat in this booking" });
            }

            if (booking.status === 'completed' || booking.status === 'cancelled') {
                return socket.emit('chat:error', { message: "Chat is closed because this booking has ended" });
            }

            const socketMessage = await Message.create({
                booking: bookingId,
                sender: senderId,
                senderModel: senderType === 'user' ? 'User' : 'Worker',
                content: normalizedContent || 'Voice message',
                messageType,
                ...(isAudioMessage ? {
                    audioUrl,
                    audioDurationSeconds: Math.min(120, Math.max(0, Number(audioDurationSeconds || 0))),
                } : {}),
            });

            io.to(`user:${booking.customer.toString()}`).emit('chat:receive', socketMessage);
            io.to(`worker:${booking.worker.toString()}`).emit('chat:receive', socketMessage);

            logger.info(`💬 Chat message emitted via socket for booking ${bookingId}`);

        } catch (error) {
            logger.error("Error in chat:send handler:", error);
            socket.emit('chat:error', { message: "Failed to send message" });
        }
    });

    socket.on('chat:typing', (data) => {
        const { bookingId, recipientId, recipientType } = data;
        io.to(`${recipientType}:${recipientId}`).emit('chat:typing', { bookingId, senderId: (socket as any).user.id });
    });
};
