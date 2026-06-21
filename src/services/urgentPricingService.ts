import JobPost from '../models/JobPost';
import Worker from '../models/Workers';
import { getUrgentRateForCategory } from './platformSettingsService';
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

export async function calculateUrgentPrice(category: string, estimatedHours: number): Promise<PriceEstimate> {
    const rateInfo = await getUrgentRateForCategory(category);
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
        const elapsedMs = Date.now() - job.createdAt.getTime();

        const io = getIO();

        if (elapsedMs < 15 * 60 * 1000) {
            // First 10-minute check: suggest manual escalation rather than auto-escalating
            // Extend expiresAt by another 10 minutes so that the job doesn't expire immediately
            job.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
            await job.save();

            logger.info(`⚡ [Urgent Check] Job ${jobId} reached 10-minute mark. Suggesting manual escalation.`);

            // Notify customer that they can manually escalate/boost the price
            io.to(`user:${job.customer.toString()}`).emit('job:search_extended', {
                jobId: job._id.toString(),
                suggestEscalation: true,
                urgencyPricingVersion: currentVersion
            });

            // Schedule the second check (timeout check) in 10 minutes
            scheduleEscalation(jobId, 10 * 60 * 1000);
        } else {
            // 20-minute (or later) check:
            // Only expire if the current time is past or very close to expiresAt
            const now = Date.now();
            if (now >= job.expiresAt.getTime() - 2000) {
                logger.info(`⚡ [Urgent Timeout] Job ${jobId} has reached the timeout with no takers.`);

                // Notify customer that search has timed out
                io.to(`user:${job.customer.toString()}`).emit('job:search_extended', {
                    jobId: job._id.toString(),
                    timeout: true,
                    urgencyPricingVersion: currentVersion
                });
            } else {
                logger.info(`⚡ [Urgent Check] Job ${jobId} check ignored because expiresAt (${job.expiresAt}) is in the future.`);
            }
        }
    } catch (error) {
        logger.error(`Error in escalateJobPrice for job ${jobId}:`, error);
    }
}

export async function manuallyEscalateJobPrice(jobId: string): Promise<{ success: boolean; newPrice: number; expiresAt: Date }> {
    const job = await JobPost.findById(jobId);
    if (!job) {
        throw new Error("Job post not found");
    }
    if (job.status !== 'open' || job.urgency !== 'instant' || !job.isFixedPrice) {
        throw new Error("Job is not eligible for pricing escalation");
    }
    if (job.urgencyPricingVersion !== 1) {
        throw new Error("Job pricing is already escalated");
    }

    const oldPrice = job.amount || 0;
    const newPrice = Math.round(oldPrice * 1.15);
    job.amount = newPrice;
    job.radiusExpanded = true;
    job.urgencyPricingVersion = 2;

    // Extend expiration by 10 minutes from now
    const newExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    job.expiresAt = newExpiresAt;

    await job.save();

    logger.info(`⚡ [Urgent Manual Escalation] Job ${jobId} price escalated from Rs. ${oldPrice} to Rs. ${newPrice} (15% increase)`);

    const io = getIO();

    // Notify customer
    io.to(`user:${job.customer.toString()}`).emit('job:search_extended', {
        jobId: job._id.toString(),
        newPrice,
        radiusExpanded: true,
        urgencyPricingVersion: 2
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

    // Update notified workers count
    job.notifiedWorkersCount = nearbyWorkers.length;
    await job.save();

    logger.info(`⚡ [Urgent Manual Escalation] Re-broadcasting Job ${jobId} to ${nearbyWorkers.length} workers with escalated price Rs. ${newPrice}`);

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

    // Schedule the timeout check at 10 min mark from now
    scheduleEscalation(jobId, 10 * 60 * 1000);

    return {
        success: true,
        newPrice,
        expiresAt: newExpiresAt
    };
}

export function scheduleEscalation(jobId: string, delayMs: number): void {
    setTimeout(async () => {
        await escalateJobPrice(jobId);
    }, delayMs);
}
