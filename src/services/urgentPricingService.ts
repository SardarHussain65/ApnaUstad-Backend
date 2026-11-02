import JobPost from '../models/JobPost';
import Worker from '../models/Workers';
import { getIO } from '../sockets/socketManager';
import logger from '../config/logger';
import { buildWorkerSpecialtyCategoryFilter } from './workerSpecialtyService';
import { buildAvailableWorkerFilterForJobType } from './workerJobAvailabilityService';
import { sendNotificationToRecipient } from './notificationHelper';

const DEFAULT_JOB_RADIUS_METERS = 100000;

export async function escalateJobPrice(jobId: string): Promise<void> {
    try {
        const job = await JobPost.findById(jobId);
        if (!job || job.status !== 'open' || job.urgency !== 'instant') {
            return;
        }

        const currentVersion = job.urgencyPricingVersion || 1;

        // Keep the job active and discoverable: extend expiresAt by 10 minutes so workers can always accept
        job.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await job.save();

        logger.info(`⚡ [Urgent Search] Job ${jobId} 10-minute round elapsed. Prompting customer for rate boost; search remains active.`);

        const io = getIO();
        io.to(`user:${job.customer.toString()}`).emit('job:search_extended', {
            jobId: job._id.toString(),
            suggestEscalation: true,
            urgencyPricingVersion: currentVersion,
            amount: job.amount,
            expiresAt: job.expiresAt
        });

        // Automatically re-schedule next 10-minute reminder if job is still open
        scheduleEscalation(jobId, 10 * 60 * 1000);
    } catch (error) {
        logger.error(`Error in escalateJobPrice for job ${jobId}:`, error);
    }
}

export interface EscalateOptions {
    newPrice?: number | undefined;
    additionalMinutes?: number | undefined;
}

export async function manuallyEscalateJobPrice(
    jobId: string,
    options?: EscalateOptions
): Promise<{ success: boolean; newPrice: number; expiresAt: Date }> {
    const job = await JobPost.findById(jobId);
    if (!job) {
        throw new Error("Job post not found");
    }
    if (job.status !== 'open' || job.urgency !== 'instant') {
        throw new Error("Rate cannot be increased for this job right now");
    }

    const oldPrice = Number(job.amount || 0);
    // User-decided new price, or keep existing price if extending search time
    let newPrice = options?.newPrice && options.newPrice > 0 ? options.newPrice : oldPrice;

    job.amount = newPrice;
    if (job.pricing) {
        job.pricing.clientOffer = newPrice;
    }
    job.radiusExpanded = true;
    job.urgencyPricingVersion = (job.urgencyPricingVersion || 1) + 1;

    // Extend expiration by requested minutes (default 10 minutes) from now
    const extensionMinutes = options?.additionalMinutes && options.additionalMinutes > 0 ? options.additionalMinutes : 10;
    const newExpiresAt = new Date(Date.now() + extensionMinutes * 60 * 1000);
    job.expiresAt = newExpiresAt;

    await job.save();

    logger.info(`⚡ [Urgent Escalation] Job ${jobId} updated: price Rs. ${oldPrice} -> Rs. ${newPrice}, extended by ${extensionMinutes} min`);

    const io = getIO();

    // Notify customer
    io.to(`user:${job.customer.toString()}`).emit('job:search_extended', {
        jobId: job._id.toString(),
        newPrice,
        expiresAt: newExpiresAt,
        radiusExpanded: true,
        resumed: true,
        urgencyPricingVersion: job.urgencyPricingVersion
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

    logger.info(`⚡ [Urgent Escalation] Re-broadcasting Job ${jobId} to ${nearbyWorkers.length} workers with price Rs. ${newPrice}`);

    for (const worker of nearbyWorkers) {
        io.to(`worker:${worker._id.toString()}`).emit('job:new', populatedJob);
        sendNotificationToRecipient(
            worker._id,
            'worker',
            `🔥 Urgent Job Updated!`,
            `The rate for the ${job.category} job near you is now Rs. ${newPrice.toLocaleString()}!`,
            { jobId: job._id.toString(), type: 'new_job' }
        ).catch(err => logger.error(`Failed to send notification to worker ${worker._id}:`, err));
    }

    // Schedule the timeout check at the end of this extension window
    scheduleEscalation(jobId, extensionMinutes * 60 * 1000);

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
