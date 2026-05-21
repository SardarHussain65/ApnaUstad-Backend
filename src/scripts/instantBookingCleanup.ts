import cron from 'node-cron';
import Booking from '../models/Booking';
import { getIO } from '../sockets/socketManager';
import { emitBookingEvent } from '../sockets/handlers/booking.handler';
import logger from '../config/logger';
import { syncPaymentForBookingStatus } from '../services/paymentLedgerService';

export const startInstantBookingCleanup = () => {
    // Runs every 1 minute
    cron.schedule('* * * * *', async () => {
        try {
            const expired = await Booking.find({
                status: 'pending',
                bookingType: 'instant',
                expiresAt: { $lt: new Date() }
            });

            if (expired.length > 0) {
                logger.info(`Found ${expired.length} expired instant bookings to cancel.`);
            }

            for (const booking of expired) {
                booking.status = 'cancelled';
                booking.cancelledBy = 'admin';
                booking.cancelReason = 'Worker did not respond in time';
                await booking.save();
                await syncPaymentForBookingStatus(booking);
                
                emitBookingEvent(getIO(), booking, 'booking:cancelled');
            }
        } catch (error) {
            logger.error('Error in instantBookingCleanup cron job:', error);
        }
    });

    logger.info('🕒 Instant Booking Cleanup cron job started (runs every minute)');
};
