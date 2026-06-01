import Worker from "../models/Workers";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../utils/ApiError";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { recordAdminAction } from "../services/adminAuditLog";

/**
 * Get all workers for admin management
 * @route GET /api/v1/admin/workers
 * 
 */

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const getAllWorkers = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { status, verified, city, category, search, page = '1', limit = '100' } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 100, 200);
    const skip = (pageNum - 1) * limitNum;

    let query: any = {};
    const verifiedValue = String(verified || '').toLowerCase();
    const statusValue = String(status || '').toLowerCase();

    if (verifiedValue === 'true') query.isVerified = true;
    if (verifiedValue === 'false') query.isVerified = false;

    if (['active', 'true'].includes(statusValue)) query.isActive = true;
    if (['inactive', 'false'].includes(statusValue)) query.isActive = false;

    if (city && city !== 'undefined') query.city = new RegExp(`^${escapeRegex(city as string)}$`, 'i');
    if (category && category !== 'undefined') query.category = new RegExp(`^${escapeRegex(category as string)}$`, 'i');
    if (search && search !== 'undefined') {
        const searchRegex = new RegExp(escapeRegex(search as string), 'i');
        query.$or = [
            { fullName: searchRegex },
            { phone: searchRegex },
            { email: searchRegex },
            { cnicNumber: searchRegex },
            { category: searchRegex },
            { city: searchRegex }
        ];
    }

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
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

    if (reason.length > 500) {
        throw new BadRequestError("Reason is too long");
    }

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

    await recordAdminAction(req, {
        action: isVerified ? 'worker.verify' : 'worker.reject_verification',
        entityType: 'worker',
        entityId: worker._id.toString(),
        reason,
        metadata: {
            fullName: worker.fullName,
            phone: worker.phone,
            email: worker.email,
            category: worker.category
        }
    });

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
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

    if (reason.length > 500) {
        throw new BadRequestError("Reason is too long");
    }

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

    await recordAdminAction(req, {
        action: isActive ? 'worker.activate' : 'worker.deactivate',
        entityType: 'worker',
        entityId: worker._id.toString(),
        reason,
        metadata: {
            fullName: worker.fullName,
            phone: worker.phone,
            email: worker.email,
            category: worker.category
        }
    });

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

/**
 * Update worker profile (admin override)
 * @route PATCH /api/v1/admin/workers/:id
 */
export const updateWorkerProfile = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { fullName, phone, email, category, hourlyRate, bio, experience, city, address } = req.body;

    const worker = await Worker.findById(id);
    if (!worker) {
        throw new NotFoundError("Worker not found");
    }

    if (fullName) worker.fullName = fullName;
    if (phone) worker.phone = phone;
    if (email !== undefined) worker.email = email;
    if (category) worker.category = category;
    if (hourlyRate !== undefined) worker.hourlyRate = Number(hourlyRate);
    if (bio !== undefined) worker.bio = bio;
    if (experience !== undefined) worker.experience = Number(experience);
    if (city) worker.city = city;
    if (address !== undefined) worker.address = address;

    await worker.save();

    await recordAdminAction(req, {
        action: 'worker.update_profile',
        entityType: 'worker',
        entityId: worker._id.toString(),
        reason: 'Admin updated worker profile',
        metadata: {
            fullName: worker.fullName,
            phone: worker.phone,
            category: worker.category,
            hourlyRate: worker.hourlyRate
        }
    });

    return successResponse(res, 200, "Worker profile updated successfully", worker);
});
