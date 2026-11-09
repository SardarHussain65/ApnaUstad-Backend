import cron from 'node-cron';
import Booking from '../models/Booking';
import JobPost from '../models/JobPost';
import { getIO } from '../sockets/socketManager';
import { emitBookingEvent } from '../sockets/handlers/booking.handler';
import logger from '../config/logger';
import { syncPaymentForBookingStatus } from '../services/paymentLedgerService';
import { releaseCommissionReservation } from '../services/commissionReservationService';

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
                await releaseCommissionReservation(booking._id);
                await syncPaymentForBookingStatus(booking);
                
                emitBookingEvent(getIO(), booking, 'booking:cancelled');
            }

            // Sweep expired open job posts
            const expiredJobs = await JobPost.find({
                status: 'open',
                expiresAt: { $lt: new Date() }
            });

            if (expiredJobs.length > 0) {
                logger.info(`Found ${expiredJobs.length} expired open job posts to close.`);
                const io = getIO();
                for (const job of expiredJobs) {
                    job.status = 'closed';
                    await job.save();
                    if (io) {
                        io.emit('job:status', { jobId: job._id.toString(), status: 'closed' });
                        io.emit('job:cancelled', { jobId: job._id.toString() });
                    }
                }
            }
        } catch (error) {
            logger.error('Error in instantBookingCleanup cron job:', error);
        }
    });

    logger.info('🕒 Instant Booking Cleanup cron job started (runs every minute)');
};
