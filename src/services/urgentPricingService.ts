import JobPost from '../models/JobPost';
import Worker from '../models/Workers';
import { getRateForCategory } from '../data/urgentPricingRates';
import { getIO } from '../sockets/socketManager';
import logger from '../config/logger';
import { buildWorkerSpecialtyCategoryFilter } from './workerSpecialtyService';
import { buildAvailableWorkerFilterForJobType } from './workerJobAvailabilityService';
import { sendNotificationToRecipient } from './notificationHelper';

const DEFAULT_JOB_RADIUS_METERS = 100000;

export interface PriceEstimate {
    fixedPrice: number;
    baseRate: number;
    estimatedHours: number;
    breakdown: string;
}

export function calculateUrgentPrice(category: string, estimatedHours: number): PriceEstimate {
    const rateInfo = getRateForCategory(category);
    const baseRate = rateInfo.baseRatePerHour;
    const minPrice = rateInfo.minimumPrice;
    
    let calculated = baseRate * estimatedHours;
    if (calculated < minPrice) {
        calculated = minPrice;
    }
    
    return {
        fixedPrice: calculated,
        baseRate,
        estimatedHours,
        breakdown: `Rs ${baseRate}/hr × ${estimatedHours} hrs = Rs ${calculated.toLocaleString()}`
    };
}

export async function escalateJobPrice(jobId: string): Promise<void> {
    try {
        const job = await JobPost.findById(jobId);
        if (!job || job.status !== 'open' || job.urgency !== 'instant' || !job.isFixedPrice) {
            return;
        }

        const currentVersion = job.urgencyPricingVersion || 1;
        const nextVersion = currentVersion + 1;
        job.urgencyPricingVersion = nextVersion;

        const io = getIO();

        if (nextVersion === 2) {
            // Escalate price by 15%
            const oldPrice = job.amount || 0;
            const newPrice = Math.round(oldPrice * 1.15);
            job.amount = newPrice;
            job.radiusExpanded = true;
            
            // Re-extend expiration by another 10 minutes
            job.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
            await job.save();

            logger.info(`⚡ [Urgent Escalation] Job ${jobId} price escalated from Rs. ${oldPrice} to Rs. ${newPrice} (15% increase)`);

            // Notify customer
            io.to(`user:${job.customer.toString()}`).emit('job:search_extended', {
                jobId: job._id.toString(),
                newPrice,
                radiusExpanded: true,
                urgencyPricingVersion: nextVersion
            });

            // Fetch customer details to build signal payload
            const populatedJob = await JobPost.findById(job._id).populate('customer', 'fullName profileImage phone');
            
            // Re-broadcast to workers (expanded radius)
            const categoryFilter = await buildWorkerSpecialtyCategoryFilter(job.category);
            const nearbyWorkers = await Worker.find({
                ...categoryFilter,
                ...buildAvailableWorkerFilterForJobType('instant'),
                location: {
                    $near: {
                        $geometry: job.location,
                        $maxDistance: DEFAULT_JOB_RADIUS_METERS
                    }
                }
            }).limit(20).select('_id');

            logger.info(`⚡ [Urgent Escalation] Re-broadcasting Job ${jobId} to ${nearbyWorkers.length} workers with escalated price Rs. ${newPrice}`);

            for (const worker of nearbyWorkers) {
                io.to(`worker:${worker._id.toString()}`).emit('job:new', populatedJob);
                sendNotificationToRecipient(
                    worker._id,
                    'worker',
                    `🔥 Urgent Job Price Escalated!`,
                    `The price for the ${job.category} job near you is now Rs. ${newPrice.toLocaleString()}`,
                    { jobId: job._id.toString(), type: 'new_job' }
                ).catch(err => logger.error(`Failed to send escalation notification to worker ${worker._id}:`, err));
            }

            // Schedule the second check at 20 min mark (10 min from now)
            scheduleEscalation(jobId, 10 * 60 * 1000);
        } else {
            // 20-minute total check: if still open, notify customer that search has timed out
            logger.info(`⚡ [Urgent Timeout] Job ${jobId} has reached the 20-minute timeout with no takers.`);
            
            // Notify customer to extend or cancel
            io.to(`user:${job.customer.toString()}`).emit('job:search_extended', {
                jobId: job._id.toString(),
                timeout: true,
                urgencyPricingVersion: nextVersion
            });
        }
    } catch (error) {
        logger.error(`Error in escalateJobPrice for job ${jobId}:`, error);
    }
}

export function scheduleEscalation(jobId: string, delayMs: number): void {
    setTimeout(async () => {
        await escalateJobPrice(jobId);
    }, delayMs);
}
