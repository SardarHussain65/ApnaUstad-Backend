import { Server, Socket } from 'socket.io';
import Message from '../../models/Message';
import Booking from '../../models/Booking';
import logger from '../../config/logger';

export const registerChatHandlers = (io: Server, socket: Socket) => {
    socket.on('chat:send', async (data) => {
        try {
            const { bookingId, content } = data;
            const senderId = (socket as any).user.id;
            const senderType = (socket as any).user.type; // 'user' or 'worker'

            if (!bookingId || !content) {
                return socket.emit('chat:error', { message: "Invalid chat data" });
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

            // Emit to both parties in the thread
            const socketMessage = {
                booking: bookingId,
                sender: senderId,
                senderModel: senderType === 'user' ? 'User' : 'Worker',
                content: content,
                createdAt: new Date().toISOString()
            };

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
