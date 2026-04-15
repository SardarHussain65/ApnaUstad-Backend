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

            // Save to DB
            const newMessage = await Message.create({
                booking: bookingId,
                sender: senderId,
                senderModel: senderType === 'user' ? 'User' : 'Worker',
                content: content
            });

            // Target recipient
            const recipientId = isCustomer ? booking.worker.toString() : booking.customer.toString();
            const recipientType = isCustomer ? 'worker' : 'user';

            // Emit to both parties in the thread
            io.to(`user:${booking.customer.toString()}`).emit('chat:receive', newMessage);
            io.to(`worker:${booking.worker.toString()}`).emit('chat:receive', newMessage);

            logger.info(`💬 Chat message saved and emitted for booking ${bookingId}`);

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
