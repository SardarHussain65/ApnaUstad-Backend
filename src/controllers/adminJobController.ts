import JobPost from "../models/JobPost";
import JobBid from "../models/JobBid";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { NotFoundError, BadRequestError } from "../utils/ApiError";
import { recordAdminAction } from "../services/adminAuditLog";
import { getIO } from "../sockets/socketManager";

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Get all job posts for admin with pagination and filtering
 * @route GET /api/v1/admin/jobs
 */
export const getAllJobs = asyncHandler(async (req: AdminAuthRequest, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 200);
    const search = req.query.search as string;
    const status = req.query.status as string;
    const category = req.query.category as string;
    const urgency = req.query.urgency as string;

    const query: any = {};
    if (search) {
        const searchRegex = new RegExp(escapeRegex(search), 'i');
        query.$or = [
            { description: searchRegex },
            { category: searchRegex },
            { location: searchRegex }
        ];
    }
    if (status && status !== 'undefined') {
        query.status = status;
    }
    if (category && category !== 'undefined') {
        query.category = category;
    }
    if (urgency && urgency !== 'undefined') {
        query.urgency = urgency;
    }

    const total = await JobPost.countDocuments(query);
    const jobs = await JobPost.find(query)
        .populate('customer', 'fullName phone profileImage')
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 });
    const acceptedBids = await JobBid.find({
        jobPost: { $in: jobs.map(job => job._id) },
        status: 'accepted'
    }).populate('worker', 'fullName phone profileImage');
    const acceptedBidByJob = new Map(acceptedBids.map(bid => [bid.jobPost.toString(), bid.toObject()]));
    const rows = jobs.map(job => ({
        ...job.toObject(),
        acceptedBid: acceptedBidByJob.get(job._id.toString()) || null
    }));

    return paginatedResponse(res, 200, "Jobs fetched successfully", rows, page, limit, total);
});

/**
 * Get job details by ID
 * @route GET /api/v1/admin/jobs/:id
 */
export const getJobDetails = asyncHandler(async (req: AdminAuthRequest, res) => {
    const job = await JobPost.findById(req.params.id)
        .populate('customer', 'fullName phone profileImage');

    if (!job) throw new NotFoundError("Job not found");

    const bids = await JobBid.find({ jobPost: job._id })
        .populate('worker', 'fullName phone profileImage rating totalReviews totalJobs category')
        .sort({ createdAt: -1 });

    return successResponse(res, 200, "Job details fetched successfully", {
        ...job.toObject(),
        bids
    });
});

/**
 * Delete a job post
 * @route DELETE /api/v1/admin/jobs/:id
 */
export const deleteJob = asyncHandler(async (req: AdminAuthRequest, res) => {
    const reason = typeof req.body?.reason === 'string'
        ? req.body.reason.trim()
        : typeof req.query?.reason === 'string'
            ? String(req.query.reason).trim()
            : '';

    const job = await JobPost.findByIdAndDelete(req.params.id);
    if (!job) throw new NotFoundError("Job not found");

    await recordAdminAction(req, {
        action: 'job.delete',
        entityType: 'job',
        entityId: job._id.toString(),
        reason,
        metadata: {
            category: job.category,
            status: job.status,
            customer: job.customer?.toString?.() || ''
        }
    });

    return successResponse(res, 200, "Job deleted successfully", null);
});

/**
 * Cancel a job post (admin moderation)
 * @route PATCH /api/v1/admin/jobs/:id/cancel
 */
export const cancelJob = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

    const job = await JobPost.findById(id);
    if (!job) throw new NotFoundError("Job not found");

    if (job.status === 'cancelled') {
        return successResponse(res, 200, "Job already cancelled", job);
    }

    job.status = 'cancelled';
    job.cancelledBy = 'admin';
    job.cancelReason = reason;
    job.cancelledAt = new Date();
    await job.save();

    await JobBid.updateMany(
        { jobPost: job._id, status: 'pending' },
        { $set: { status: 'rejected' } }
    );

    try {
        const io = getIO();
        io.emit('job:cancelled', { jobId: job._id, reason });
    } catch (error) {
        // Ignore socket errors
    }

    await recordAdminAction(req, {
        action: 'job.cancel',
        entityType: 'job',
        entityId: job._id.toString(),
        reason,
        metadata: {
            category: job.category,
            status: job.status,
            customer: job.customer?.toString?.() || ''
        }
    });

    return successResponse(res, 200, "Job cancelled successfully", job);
});

/**
 * Update job post status (admin override)
 * @route PATCH /api/v1/admin/jobs/:id/status
 */
export const updateJobStatus = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { status: nextStatus, reason } = req.body;

    if (!nextStatus) {
        throw new BadRequestError("Status is required");
    }

    const job = await JobPost.findById(id);
    if (!job) throw new NotFoundError("Job not found");

    const previousStatus = job.status;
    job.status = nextStatus;

    if (nextStatus === 'cancelled') {
        job.cancelledBy = 'admin';
        job.cancelReason = reason || 'Admin force cancel';
        job.cancelledAt = new Date();
    }
    await job.save();

    if (nextStatus === 'cancelled') {
        await JobBid.updateMany(
            { jobPost: job._id, status: 'pending' },
            { $set: { status: 'rejected' } }
        );
    }

    await recordAdminAction(req, {
        action: 'job.update_status',
        entityType: 'job',
        entityId: job._id.toString(),
        reason: reason || `Status force changed to ${nextStatus}`,
        metadata: {
            previousStatus,
            newStatus: nextStatus
        }
    });

    return successResponse(res, 200, `Job status updated to ${nextStatus} successfully`, job);
});
