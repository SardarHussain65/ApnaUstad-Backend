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
        const rawCustomer = booking?.customer;
        const rawWorker = booking?.worker;
        const customerId = (rawCustomer?._id || rawCustomer)?.toString?.() || '';
        const workerId = (rawWorker?._id || rawWorker)?.toString?.() || '';
        const bookingId = (booking?._id || booking?.id)?.toString?.() || '';

        const customerRoom = customerId ? `user:${customerId}` : null;
        const workerRoom = workerId ? `worker:${workerId}` : null;

        // Target rooms: customer, worker, and admin room
        const emitter = io;

        switch (eventType) {
            case 'booking:new':
                // Send to worker and admin
                if (workerRoom) emitter.to(workerRoom).emit('booking:new', booking);
                emitter.to('admin').emit('booking:new', booking);
                break;
            case 'booking:accepted':
            case 'booking:ongoing':
            case 'booking:completed':
            case 'booking:cancelled':
            case 'booking:paid':
            case 'booking:price_increase_requested':
            case 'booking:price_increase_approved':
            case 'booking:price_increase_rejected':
            case 'booking:price_updated':
                // Send to both parties and admin
                if (customerRoom) emitter.to(customerRoom).emit(eventType, booking);
                if (workerRoom) emitter.to(workerRoom).emit(eventType, booking);
                emitter.to('admin').emit(eventType, booking);
                break;
            default:
                logger.warn(`Unknown booking event type: ${eventType}`);
        }

        // Always emit a generic status update for surgical UI refetching
        const statusPayload = { 
            bookingId, 
            status: booking?.status,
            customerId,
            workerId,
            eventType
        };

        if (customerRoom) emitter.to(customerRoom).emit('booking:status', statusPayload);
        if (workerRoom) emitter.to(workerRoom).emit('booking:status', statusPayload);
        emitter.to('admin').emit('booking:status', statusPayload);

        logger.info(`📡 [emitBookingEvent] Emitted ${eventType} and booking:status for booking ${bookingId}`);
    } catch (error) {
        logger.error(`Error emitting booking event ${eventType}:`, error);
    }
};
