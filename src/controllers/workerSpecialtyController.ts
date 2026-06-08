import { asyncHandler } from '../utils/asyncHandler';
import { AuthRequest } from '../middlewares/jwt.middleware';
import { AdminAuthRequest } from '../middlewares/admin.middleware';
import { BadRequestError, NotFoundError } from '../utils/ApiError';
import { successResponse, paginatedResponse } from '../utils/ApiResponse';
import Worker from '../models/Workers';
import Category from '../models/Category';
import { recordAdminAction } from '../services/adminAuditLog';
import { sendNotificationToRecipient } from '../services/notificationHelper';
import {
    activateWorkerSpecialty,
    ensureLegacyPrimarySpecialty,
    FREE_SPECIALTY_LIMIT,
    getAdditionalCategoryMonthlyFee,
    getSpecialtyTier,
    MAX_WORKER_SPECIALTIES,
    normalizeSpecialtyProfileInput,
    removeWorkerSpecialty,
    reorderWorkerSpecialties,
    requestWorkerSpecialty,
    reviewWorkerSpecialty,
    setWorkerSpecialtyAutoRenew
} from '../services/workerSpecialtyService';

const getWorkerId = (req: AuthRequest) => {
    const workerId = req.tokenPayload?.id;
    if (!workerId) throw new BadRequestError('Worker identity is required');
    return workerId;
};

const buildSpecialtyResponse = async (worker: any) => {
    const additionalCategoryMonthlyFee = await getAdditionalCategoryMonthlyFee();
    await worker.populate('specialties.categoryId', 'name icon color isActive additionalCategoryMonthlyFee additionalCategoryGraceDays');
    const specialties = [...(worker.specialties || [])]
        .sort((left: any, right: any) => left.priority - right.priority)
        .map((specialty: any) => ({
            ...specialty.toObject(),
            tier: getSpecialtyTier(specialty.priority)
        }));
    return {
        specialties,
        maxSpecialties: MAX_WORKER_SPECIALTIES,
        freeSpecialtyLimit: FREE_SPECIALTY_LIMIT,
        additionalCategoryMonthlyFee
    };
};

export const getMySpecialties = asyncHandler(async (req: AuthRequest, res) => {
    const worker = await Worker.findById(getWorkerId(req));
    if (!worker) throw new NotFoundError('Worker not found');
    await ensureLegacyPrimarySpecialty(worker);
    return successResponse(res, 200, 'Worker specialties fetched successfully', await buildSpecialtyResponse(worker));
});

export const requestSpecialty = asyncHandler(async (req: AuthRequest, res) => {
    const { categoryId } = req.body;
    if (!categoryId) throw new BadRequestError('categoryId is required');
    const profile = normalizeSpecialtyProfileInput(req.body);
    const worker = await requestWorkerSpecialty(getWorkerId(req), categoryId, profile);
    return successResponse(res, 201, 'Specialty request submitted for admin approval', await buildSpecialtyResponse(worker));
});

export const reorderSpecialties = asyncHandler(async (req: AuthRequest, res) => {
    const { categoryIds } = req.body;
    if (!Array.isArray(categoryIds)) throw new BadRequestError('categoryIds array is required');
    const worker = await reorderWorkerSpecialties(getWorkerId(req), categoryIds);
    return successResponse(res, 200, 'Specialty priorities updated successfully', await buildSpecialtyResponse(worker));
});

export const activateSpecialty = asyncHandler(async (req: AuthRequest, res) => {
    const worker = await activateWorkerSpecialty(getWorkerId(req), req.params.categoryId as string);
    return successResponse(res, 200, 'Specialty subscription activated successfully', await buildSpecialtyResponse(worker));
});

export const updateSpecialtyAutoRenew = asyncHandler(async (req: AuthRequest, res) => {
    if (typeof req.body.autoRenew !== 'boolean') throw new BadRequestError('autoRenew boolean is required');
    const worker = await setWorkerSpecialtyAutoRenew({
        workerId: getWorkerId(req),
        categoryId: req.params.categoryId as string,
        autoRenew: req.body.autoRenew
    });
    return successResponse(res, 200, 'Specialty auto-renew preference updated successfully', await buildSpecialtyResponse(worker));
});

export const deleteSpecialty = asyncHandler(async (req: AuthRequest, res) => {
    const worker = await removeWorkerSpecialty(getWorkerId(req), req.params.categoryId as string);
    return successResponse(res, 200, 'Specialty removed successfully', await buildSpecialtyResponse(worker));
});

export const getPendingSpecialtyRequests = asyncHandler(async (req: AdminAuthRequest, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const query = { specialties: { $elemMatch: { approvalStatus: 'pending' } } };
    const [workers, total] = await Promise.all([
        Worker.find(query)
            .select('fullName phone email profileImage category specialties')
            .populate('specialties.categoryId', 'name icon color additionalCategoryMonthlyFee additionalCategoryGraceDays')
            .sort({ updatedAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit),
        Worker.countDocuments(query)
    ]);
    return paginatedResponse(res, 200, 'Pending specialty requests fetched successfully', workers, page, limit, total);
});

export const reviewSpecialtyRequest = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { approvalStatus, reason = '' } = req.body;
    if (!['approved', 'rejected'].includes(approvalStatus)) {
        throw new BadRequestError('approvalStatus must be approved or rejected');
    }
    if (!req.admin?._id) throw new BadRequestError('Admin identity is required');
    const additionalCategoryMonthlyFee = await getAdditionalCategoryMonthlyFee();
    const category = await Category.findById(req.params.categoryId).select('name').lean();
    const categoryName = category?.name || 'your new category';

    const worker = await reviewWorkerSpecialty({
        workerId: req.params.workerId as string,
        categoryId: req.params.categoryId as string,
        approvalStatus,
        adminId: req.admin._id
    });

    await recordAdminAction(req, {
        action: approvalStatus === 'approved' ? 'worker.specialty_approve' : 'worker.specialty_reject',
        entityType: 'worker',
        entityId: worker._id.toString(),
        reason,
        metadata: { categoryId: req.params.categoryId, additionalCategoryMonthlyFee }
    });
    const reviewedSpecialty = worker.specialties.find((specialty: any) => (
        specialty.categoryId?.toString?.() === req.params.categoryId
        || specialty.categoryId?._id?.toString?.() === req.params.categoryId
    ));
    const chargedAmount = Number(reviewedSpecialty?.monthlyFeeSnapshot || 0);
    sendNotificationToRecipient(
        worker._id,
        'worker',
        approvalStatus === 'approved' ? 'Category activated' : 'Specialty request rejected',
        approvalStatus === 'approved'
            ? chargedAmount > 0
                ? `Congratulations! Your ${categoryName} category is approved and active. Rs. ${chargedAmount.toLocaleString('en-PK')} has been deducted from your wallet for the first month.`
                : `Congratulations! Your ${categoryName} category is approved and active on your worker profile.`
            : `Your specialty request was rejected${reason ? `: ${reason}` : '.'}`
    ).catch(() => undefined);

    return successResponse(
        res,
        200,
        approvalStatus === 'approved'
            ? 'Specialty approved, charged, and activated successfully'
            : 'Specialty request rejected successfully',
        await buildSpecialtyResponse(worker)
    );
});
