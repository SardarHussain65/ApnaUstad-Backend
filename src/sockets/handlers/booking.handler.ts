import { Server as SocketIOServer, Socket } from 'socket.io';
import logger from '../../config/logger';

export const registerBookingHandlers = (io: SocketIOServer, socket: Socket) => {
    // Client-to-server booking events can be mapped here if needed.
    // Currently, booking events are driven by the server (HTTP controllers).
};

/**
 * Utility to emit booking events from controllers
 */
export const emitBookingEvent = (io: SocketIOServer, booking: any, eventType: string) => {
    try {
        const customerRoom = `user:${booking.customer}`;
        const workerRoom = `worker:${booking.worker}`;

        switch (eventType) {
            case 'booking:new':
                // Only to worker
                io.to(workerRoom).emit('booking:new', booking);
                break;
            case 'booking:accepted':
            case 'booking:ongoing':
                // Only to customer
                io.to(customerRoom).emit(eventType, booking);
                break;
            case 'booking:completed':
            case 'booking:cancelled':
                // To both
                io.to(customerRoom).to(workerRoom).emit(eventType, booking);
                break;
            default:
                logger.warn(`Unknown booking event type: ${eventType}`);
        }
    } catch (error) {
        logger.error(`Error emitting booking event ${eventType}:`, error);
    }
};
