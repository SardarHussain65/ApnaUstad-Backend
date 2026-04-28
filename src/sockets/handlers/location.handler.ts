import { Server as SocketIOServer, Socket } from 'socket.io';
import logger from '../../config/logger';

export const registerLocationHandlers = (io: SocketIOServer, socket: Socket) => {
    
    // Listen for live location updates from the worker
    socket.on('worker:location', (data: { bookingId: string, latitude: number, longitude: number, customerId: string }) => {
        const user = (socket as any).user;
        
        if (user.type !== 'worker') return;

        const { bookingId, latitude, longitude, customerId } = data;

        if (!bookingId || !latitude || !longitude || !customerId) {
             logger.warn(`Invalid location data from worker ${user.id}`);
             return;
        }

        // Re-emit the location to the specific customer's room
        io.to(`user:${customerId}`).emit('worker:location', {
            workerId: user.id,
            bookingId,
            latitude,
            longitude
        });
    });
};
