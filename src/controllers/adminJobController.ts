import JobPost from "../models/JobPost";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { NotFoundError } from "../utils/ApiError";

/**
 * Get all job posts for admin with pagination and filtering
 * @route GET /api/v1/admin/jobs
 */
export const getAllJobs = asyncHandler(async (req: AdminAuthRequest, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string;
    const status = req.query.status as string;

    const query: any = {};
    if (search) {
        query.$or = [
            { description: { $regex: search, $options: 'i' } }
        ];
    }
    if (status && status !== 'undefined') {
        query.status = status;
    }

    const total = await JobPost.countDocuments(query);
    const jobs = await JobPost.find(query)
        .populate('customer', 'fullName phone profileImage')
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 });

    return paginatedResponse(res, 200, "Jobs fetched successfully", jobs, page, limit, total);
});

/**
 * Get job details by ID
 * @route GET /api/v1/admin/jobs/:id
 */
export const getJobDetails = asyncHandler(async (req: AdminAuthRequest, res) => {
    const job = await JobPost.findById(req.params.id)
        .populate('customer', 'fullName phone profileImage');

    if (!job) throw new NotFoundError("Job not found");

    return successResponse(res, 200, "Job details fetched successfully", job);
});

/**
 * Delete a job post
 * @route DELETE /api/v1/admin/jobs/:id
 */
export const deleteJob = asyncHandler(async (req: AdminAuthRequest, res) => {
    const job = await JobPost.findByIdAndDelete(req.params.id);
    if (!job) throw new NotFoundError("Job not found");

    return successResponse(res, 200, "Job deleted successfully", null);
});
