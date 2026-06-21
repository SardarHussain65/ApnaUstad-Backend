import cron from 'node-cron';
import JobPost from '../models/JobPost';
import Worker from '../models/Workers';
import { getIO } from '../sockets/socketManager';
import logger from '../config/logger';
import { buildAvailableWorkerFilterForJobType } from '../services/workerJobAvailabilityService';
import { buildWorkerSpecialtyCategoryFilter } from '../services/workerSpecialtyService';
import { getPlatformSettings } from '../services/platformSettingsService';

/**
 * Script to handle Instant Job expansion and final timeout
 * 1. At 5 minutes: Expand radius to 25km and re-broadcast
 * 2. At 10 minutes: Cancel the job if still not assigned
 */
export const startInstantJobExpansion = () => {
    // Runs every minute
    cron.schedule('* * * * *', async () => {
        try {
            const platformSettings = await getPlatformSettings();
            const expansionMs = platformSettings.instantJobExpansionMinutes * 60 * 1000;
            const timeoutMs = platformSettings.instantJobTimeoutMinutes * 60 * 1000;
            const expandedRadiusMeters = platformSettings.instantJobExpandedRadiusKm * 1000;
            const now = new Date();
            const expansionThreshold = new Date(now.getTime() - expansionMs);
            const timeoutThreshold = new Date(now.getTime() - timeoutMs);

            const jobsToExpand = await JobPost.find({
                urgency: 'instant',
                status: 'open',
                radiusExpanded: false,
                isFixedPrice: { $ne: true },
                createdAt: { $lt: expansionThreshold, $gt: timeoutThreshold }
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
                            $maxDistance: expandedRadiusMeters
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
