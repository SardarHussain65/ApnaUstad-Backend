import VerificationRequest from "../models/VerificationRequest";
import Worker from "../models/Workers";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../utils/ApiError";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { recordAdminAction } from "../services/adminAuditLog";
import { reviewVerificationSchema } from "../validations/admin.validation";
import { getWalletSettings } from "../services/walletSettingsService";
import { rechargeWallet } from "../services/workerWalletService";
import { sendNotificationToRecipient } from "../services/notificationHelper";

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Get all identity verification requests
 * @route GET /api/v1/admin/verification/requests
 */
export const getVerificationRequests = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { status, search, page = '1', limit = '50' } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 50, 100);
    const skip = (pageNum - 1) * limitNum;

    let query: any = {};

    if (status) {
        query.status = status;
    }

    // If search filter exists, find workers first to match their IDs
    if (search) {
        const searchRegex = new RegExp(escapeRegex(search as string), 'i');
        const matchingWorkers = await Worker.find({
            $or: [
                { fullName: searchRegex },
                { phone: searchRegex },
                { email: searchRegex },
                { cnicNumber: searchRegex }
            ]
        }).select('_id');

        const workerIds = matchingWorkers.map(w => w._id);
        query.$or = [
            { worker: { $in: workerIds } },
            { cnicNumber: searchRegex }
        ];
    }

    const total = await VerificationRequest.countDocuments(query);
    const requests = await VerificationRequest.find(query)
        .populate('worker', 'fullName phone email profileImage category city')
        .populate('reviewedBy', 'fullName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum);

    return paginatedResponse(res, 200, "Verification requests fetched successfully", requests, pageNum, limitNum, total);
});

/**
 * Get a single identity verification request with worker context & prior history
 * @route GET /api/v1/admin/verification/requests/:id
 */
export const getVerificationRequestDetails = asyncHandler(async (req: AdminAuthRequest, res) => {
    const request = await VerificationRequest.findById(req.params.id)
        .populate('worker', 'fullName phone email profileImage category city address isVerified isActive createdAt averageRating totalReviews')
        .populate('reviewedBy', 'fullName email')
        .lean();

    if (!request) {
        throw new NotFoundError("Verification request not found");
    }

    const workerId = (request.worker as any)?._id || request.worker;
    const history = workerId
        ? await VerificationRequest.find({
              worker: workerId,
              _id: { $ne: request._id },
          })
              .populate('reviewedBy', 'fullName email')
              .sort({ createdAt: -1 })
              .limit(10)
              .lean()
        : [];

    return successResponse(res, 200, "Verification request fetched successfully", {
        ...request,
        history,
    });
});

/**
 * Review a pending identity verification request
 * @route PATCH /api/v1/admin/verification/requests/:id/review
 */
export const reviewVerificationRequest = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const adminId = req.admin?._id;

    if (!adminId) {
        throw new BadRequestError("Unauthorized admin operation");
    }

    const validation = reviewVerificationSchema.safeParse(req.body);
    if (!validation.success) {
        throw new BadRequestError(validation.error?.issues[0]?.message || "Validation failed");
    }

    const { status, rejectionReason, adminNotes } = validation.data;

    const verificationRequest = await VerificationRequest.findById(id);
    if (!verificationRequest) {
        throw new NotFoundError("Verification request not found");
    }

    if (verificationRequest.status !== 'pending') {
        throw new BadRequestError(`This verification request has already been ${verificationRequest.status}`);
    }

    const worker = await Worker.findById(verificationRequest.worker);
    if (!worker) {
        throw new NotFoundError("Worker account not found for this request");
    }

    verificationRequest.status = status;
    verificationRequest.adminNotes = adminNotes || "";
    verificationRequest.reviewedBy = adminId;
    verificationRequest.reviewedAt = new Date();

    if (status === 'approved') {
        verificationRequest.rejectionReason = "";
        
        // Mark worker as verified and copy details
        worker.isVerified = true;
        worker.cnicNumber = verificationRequest.cnicNumber;
        worker.cnicFrontImage = verificationRequest.cnicFrontImage;
        worker.cnicBackImage = verificationRequest.cnicBackImage;

        // Auto-grant Global Starter Bonus on verified CNIC if not already claimed
        let bonusAwarded = 0;
        if (!worker.hasReceivedStarterBonus) {
            try {
                const walletSettings = await getWalletSettings();
                const bonusAmount = Number(walletSettings.cnicVerificationBonus ?? 500);
                if (bonusAmount > 0) {
                    await rechargeWallet(
                        worker._id,
                        bonusAmount,
                        { actor: adminId, actorType: 'admin' },
                        'CNIC Verification Starter Bonus'
                    );
                    worker.hasReceivedStarterBonus = true;
                    bonusAwarded = bonusAmount;
                }
            } catch (walletErr: any) {
                console.error('Failed to credit starter bonus on CNIC verification:', walletErr);
            }
        }

        await worker.save();

        // Send push notification to worker
        try {
            const bodyMessage = bonusAwarded > 0
                ? `Your CNIC has been verified! A starter bonus of Rs. ${bonusAwarded.toLocaleString('en-PK')} has been credited to your wallet.`
                : "Your CNIC verification has been approved! You now have the Verified Ustad badge.";

            await sendNotificationToRecipient(
                worker._id,
                'worker',
                '🎉 CNIC Verified!',
                bodyMessage,
                { type: 'worker_verified', bonus: String(bonusAwarded) },
                { type: 'worker_verified' }
            );
        } catch (notifErr: any) {
            console.warn('Failed to send verification notification:', notifErr.message);
        }
    } else if (status === 'rejected') {
        if (!rejectionReason || rejectionReason.trim() === '') {
            throw new BadRequestError("Rejection reason is required when rejecting verification requests");
        }
        verificationRequest.rejectionReason = rejectionReason;
        
        // Revoke worker's verified status just in case they were previously verified,
        // but preserve other details so they can correct them later.
        worker.isVerified = false;
        await worker.save();

        // Send push notification to worker about rejection
        try {
            await sendNotificationToRecipient(
                worker._id,
                'worker',
                '⚠️ CNIC Verification Update',
                rejectionReason || "Your CNIC verification was not approved. Please review and re-upload.",
                { type: 'worker_verified', status: 'rejected' },
                { type: 'general' }
            );
        } catch (notifErr: any) {
            console.warn('Failed to send verification rejection notification:', notifErr.message);
        }
    }

    await verificationRequest.save();

    // Log the admin's action inside the audit ledger
    await recordAdminAction(req, {
        action: status === 'approved' ? 'worker.verify_approved' : 'worker.verify_rejected',
        entityType: 'worker',
        entityId: worker._id.toString(),
        reason: status === 'approved' ? 'Identity verification approved' : `Identity verification rejected: ${rejectionReason}`,
        metadata: {
            requestId: verificationRequest._id.toString(),
            cnicNumber: verificationRequest.cnicNumber,
            fullName: worker.fullName,
            phone: worker.phone,
        }
    });

    const message = status === 'approved' ? "Verification approved successfully" : "Verification request rejected successfully";
    return successResponse(res, 200, message, verificationRequest);
});
