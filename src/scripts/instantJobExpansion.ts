import cron from 'node-cron';
import JobPost from '../models/JobPost';
import Worker from '../models/Workers';
import { getIO } from '../sockets/socketManager';
import logger from '../config/logger';
import { buildAvailableWorkerFilterForJobType } from '../services/workerJobAvailabilityService';
import { buildWorkerSpecialtyCategoryFilter } from '../services/workerSpecialtyService';

/**
 * Script to handle Instant Job expansion and final timeout
 * 1. At 5 minutes: Expand radius to 25km and re-broadcast
 * 2. At 10 minutes: Cancel the job if still not assigned
 */
export const startInstantJobExpansion = () => {
    // Runs every minute
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
            const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

            // 1. Expand Radius for jobs older than 5 mins, not yet expanded, and still open
            const jobsToExpand = await JobPost.find({
                urgency: 'instant',
                status: 'open',
                radiusExpanded: false,
                isFixedPrice: { $ne: true },
                createdAt: { $lt: fiveMinutesAgo, $gt: tenMinutesAgo }
            });

            for (const job of jobsToExpand) {
                logger.info(`Expanding radius for instant job: ${job._id}`);
                const categoryFilter = await buildWorkerSpecialtyCategoryFilter(job.category);
                const nearbyWorkers = await Worker.find({
                    ...categoryFilter,
                    ...buildAvailableWorkerFilterForJobType('instant'),
                    location: {
                        $near: {
                            $geometry: job.location,
                            $maxDistance: 25000 // 25km
                        }
                    }
                }).limit(20).select('_id');

                const io = getIO();
                nearbyWorkers.forEach(worker => {
                    io.to(`worker:${worker._id.toString()}`).emit('job:new', job);
                });

                job.radiusExpanded = true;
                await job.save();
            }

        } catch (error) {
            logger.error('Error in instantJobExpansion cron job:', error);
        }
    });

    logger.info('🕒 Instant Job Expansion cron job started (runs every minute)');
};
