import { Server as SocketIOServer, Socket } from 'socket.io';
import logger from '../../config/logger';

export const registerNotificationHandlers = (io: SocketIOServer, socket: Socket) => {
    // Client specific notification events (e.g. mark as read) could go here
};

/**
 * Utility to emit notifications to a specific recipient
 */
export const emitNotification = (io: SocketIOServer, recipientId: string, recipientType: 'user' | 'worker', notification: any) => {
    try {
        const room = `${recipientType}:${recipientId}`;
        io.to(room).emit('notification:new', notification);
    } catch (error) {
         logger.error(`Error emitting notification to ${recipientType}:${recipientId}:`, error);
    }
};
