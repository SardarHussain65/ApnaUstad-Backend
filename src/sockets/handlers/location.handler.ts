import { Server as SocketIOServer, Socket } from 'socket.io';
import logger from '../../config/logger';
import Booking from '../../models/Booking';

export const registerLocationHandlers = (io: SocketIOServer, socket: Socket) => {
    
    // Listen for live location updates from the worker
    socket.on('worker:location', async (data: { bookingId: string, latitude: number, longitude: number }) => {
        const user = (socket as any).user;
        
        if (user.type !== 'worker') return;

        const { bookingId, latitude, longitude } = data;

        if (!bookingId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
             logger.warn(`Invalid location data from worker ${user.id}`);
             return;
        }

        try {
            const booking = await Booking.findOne({ _id: bookingId, worker: user.id }).select('customer');
            if (!booking) {
                logger.warn(`Rejected location update from worker ${user.id} for unassigned booking ${bookingId}`);
                return;
            }

            // Resolve the destination room from the authoritative booking record.
            io.to(`user:${booking.customer.toString()}`).emit('worker:location', {
                workerId: user.id,
                bookingId,
                latitude,
                longitude
            });
        } catch (error) {
            logger.error(`Failed to relay worker location for booking ${bookingId}:`, error);
        }
    });
};
