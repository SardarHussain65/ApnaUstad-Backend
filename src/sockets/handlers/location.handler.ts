import { Server as SocketIOServer, Socket } from 'socket.io';
import logger from '../../config/logger';
import Booking from '../../models/Booking';
import Workers from '../../models/Workers';

export const isWithinPakistanBounds = (lat: number, lng: number): boolean => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    const isEmulator =
        (Math.abs(lat - 37.422) < 0.05 && Math.abs(lng - (-122.084)) < 0.05) ||
        (Math.abs(lat - 37.33) < 0.05 && Math.abs(lng - (-122.03)) < 0.05);
    if (isEmulator) return false;
    return lat >= 23.0 && lat <= 37.5 && lng >= 60.0 && lng <= 78.5;
};

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

        if (!isWithinPakistanBounds(latitude, longitude)) {
            logger.warn(`Ignored location update outside Pakistan from worker ${user.id}: [lat: ${latitude}, lng: ${longitude}]`);
            return;
        }

        try {
            const booking = await Booking.findOne({ _id: bookingId, worker: user.id }).select('customer');
            if (!booking) {
                logger.warn(`Rejected location update from worker ${user.id} for unassigned booking ${bookingId}`);
                return;
            }

            // Persist valid worker live location to database so subsequent queries and admin views have real coordinates
            await Workers.findByIdAndUpdate(user.id, {
                'location.type': 'Point',
                'location.coordinates': [longitude, latitude]
            }).catch(err => {
                logger.error(`Error saving worker live location in database:`, err);
            });

            const payload = {
                workerId: user.id,
                bookingId,
                latitude,
                longitude,
                timestamp: Date.now()
            };

            // Relay live coordinates to customer, booking room, and admin
            io.to(`user:${booking.customer.toString()}`).emit('worker:location', payload);
            io.to(`booking:${bookingId}`).emit('worker:location', payload);
            io.to('admin').emit('worker:location', payload);
        } catch (error) {
            logger.error(`Failed to relay worker location for booking ${bookingId}:`, error);
        }
    });
};
