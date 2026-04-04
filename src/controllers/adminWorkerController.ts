import Worker from "../models/Workers";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../utils/ApiError";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";

/**
 * Get all workers for admin management
 * @route GET /api/v1/admin/workers
 * 
 */

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const getAllWorkers = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { status, verified, city, page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    let query: any = {};
    if (verified !== undefined) query.isVerified = verified === 'true';
    if (status !== undefined) query.isActive = status === 'active';
    if (city) query.city = new RegExp(escapeRegex(city as string), 'i');

    const total = await Worker.countDocuments(query);
    const workers = await Worker.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum);

    return paginatedResponse(res, 200, "Workers fetched successfully", workers, pageNum, limitNum, total);
});

/**
 * Verify / Approve a worker
 * @route PATCH /api/v1/admin/workers/:id/verify
 */
export const verifyWorker = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { isVerified } = req.body;

    if (isVerified === undefined) {
        throw new BadRequestError("isVerified field is required");
    }

    const worker = await Worker.findByIdAndUpdate(
        id,
        { isVerified },
        { new: true, runValidators: true }
    );

    if (!worker) {
        throw new NotFoundError("Worker not found");
    }

    const message = isVerified ? "Worker verified successfully" : "Worker verification revoked";
    return successResponse(res, 200, message, worker);
});

/**
 * Activate / Deactivate a worker
 * @route PATCH /api/v1/admin/workers/:id/status
 */
export const toggleWorkerStatus = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
        throw new BadRequestError("isActive field is required");
    }

    const worker = await Worker.findByIdAndUpdate(
        id,
        { isActive },
        { new: true, runValidators: true }
    );

    if (!worker) {
        throw new NotFoundError("Worker not found");
    }

    const message = isActive ? "Worker activated successfully" : "Worker deactivated successfully";
    return successResponse(res, 200, message, worker);
});

/**
 * Get single worker details for admin
 * @route GET /api/v1/admin/workers/:id
 */
export const getWorkerDetails = asyncHandler(async (req: AdminAuthRequest, res) => {
    const worker = await Worker.findById(req.params.id);
    if (!worker) {
        throw new NotFoundError("Worker not found");
    }
    return successResponse(res, 200, "Worker details fetched successfully", worker);
});
