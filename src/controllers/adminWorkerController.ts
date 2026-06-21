import Worker from "../models/Workers";
import WorkerWallet from "../models/WorkerWallet";
import VerificationRequest from "../models/VerificationRequest";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../utils/ApiError";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { recordAdminAction } from "../services/adminAuditLog";
import { getWalletSettings } from "../services/walletSettingsService";
import {
    applyMatchedSpecialtyProfileToWorkerPayload,
    approveFreeSpecialtiesForVerifiedWorker,
    buildWorkerSpecialtyCategoryFilter,
    setWorkerPrimarySpecialtyFromLegacyCategory
} from "../services/workerSpecialtyService";

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
    if (category && category !== 'undefined') query.$and = [await buildWorkerSpecialtyCategoryFilter(category as string)];
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
    const data = category && category !== 'undefined'
        ? await Promise.all(workers.map(worker => applyMatchedSpecialtyProfileToWorkerPayload(worker, category as string)))
        : workers;

    return paginatedResponse(res, 200, "Workers fetched successfully", data, pageNum, limitNum, total);
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
    if (isVerified) {
        await approveFreeSpecialtiesForVerifiedWorker(worker);
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
    if (isActive === false && !reason) {
        throw new BadRequestError("Deactivation reason is required");
    }

    const worker = await Worker.findByIdAndUpdate(
        id,
        isActive
            ? {
                isActive: true,
                deactivationReason: '',
                reactivatedAt: new Date(),
                reactivatedBy: req.admin?._id || null,
            }
            : {
                isActive: false,
                isAvailable: false,
                isInstantAvailable: false,
                isScheduledAvailable: false,
                deactivationReason: reason,
                deactivatedAt: new Date(),
                deactivatedBy: req.admin?._id || null,
            },
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
            category: worker.category,
            isActive: worker.isActive,
            deactivationReason: worker.deactivationReason || ''
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
    const worker = await Worker.findById(req.params.id)
        .populate('specialties.categoryId', 'name icon color isActive additionalCategoryMonthlyFee additionalCategoryGraceDays');
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
    if (category) {
        await setWorkerPrimarySpecialtyFromLegacyCategory({
            worker,
            categoryName: category,
            approveImmediately: true,
            ...(req.admin?._id ? { adminId: req.admin._id } : {})
        });
    }
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

const buildOnboardingStatus = (worker: any, walletBalance: number, minBalance: number, pendingVerification: boolean) => {
    const pendingSpecialty = (worker.specialties || []).some(
        (specialty: any) => specialty.approvalStatus === 'pending'
    );
    const cnicStatus = worker.isVerified ? 'complete' : pendingVerification ? 'pending' : 'missing';
    const specialtyStatus = pendingSpecialty ? 'pending' : 'complete';
    const walletStatus = walletBalance >= minBalance ? 'complete' : 'blocked';
    const blockers: string[] = [];
    if (cnicStatus !== 'complete') blockers.push('CNIC verification');
    if (specialtyStatus === 'pending') blockers.push('Specialty approval');
    if (walletStatus === 'blocked') blockers.push('Minimum wallet balance');

    return {
        cnic: cnicStatus,
        specialty: specialtyStatus,
        wallet: walletStatus,
        isReady: blockers.length === 0,
        blockers,
        walletBalance,
        minimumWalletBalance: minBalance,
    };
};

/**
 * Worker onboarding pipeline queue
 * @route GET /api/v1/admin/workers/onboarding
 */
export const getWorkerOnboardingQueue = asyncHandler(async (req: AdminAuthRequest, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const walletSettings = await getWalletSettings();

    const query: any = {
        $or: [
            { isVerified: false },
            { specialties: { $elemMatch: { approvalStatus: 'pending' } } },
        ],
    };

    if (search) {
        const searchRegex = new RegExp(escapeRegex(search), 'i');
        query.$and = [{
            $or: [
                { fullName: searchRegex },
                { phone: searchRegex },
                { email: searchRegex },
                { city: searchRegex },
            ],
        }];
    }

    const [workers, total] = await Promise.all([
        Worker.find(query)
            .sort({ updatedAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .populate('specialties.categoryId', 'name icon color'),
        Worker.countDocuments(query),
    ]);

    const workerIds = workers.map((worker) => worker._id);
    const [wallets, pendingVerifications] = await Promise.all([
        WorkerWallet.find({ worker: { $in: workerIds } }).lean(),
        VerificationRequest.find({ worker: { $in: workerIds }, status: 'pending' }).select('worker').lean(),
    ]);

    const walletByWorker = new Map(wallets.map((wallet) => [wallet.worker.toString(), Number(wallet.balance || 0)]));
    const pendingVerificationWorkers = new Set(pendingVerifications.map((request) => request.worker.toString()));

    const rows = workers.map((worker) => {
        const walletBalance = walletByWorker.get(worker._id.toString()) || 0;
        const onboarding = buildOnboardingStatus(
            worker,
            walletBalance,
            walletSettings.minimumWalletBalance,
            pendingVerificationWorkers.has(worker._id.toString())
        );
        return {
            ...worker.toObject(),
            onboarding,
        };
    }).filter((worker) => !worker.onboarding.isReady || walletByWorker.get(worker._id.toString())! < walletSettings.minimumWalletBalance);

    return paginatedResponse(res, 200, 'Worker onboarding queue fetched successfully', rows, page, limit, total);
});
