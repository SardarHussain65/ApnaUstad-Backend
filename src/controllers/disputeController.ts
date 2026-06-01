// src/controllers/disputeController.ts
import Dispute from "../models/Dispute";
import Booking from "../models/Booking";
import User from "../models/User";
import Worker from "../models/Workers";
import WorkerWallet from "../models/WorkerWallet";
import WalletTransaction from "../models/WalletTransaction";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../utils/ApiError";
import { AuthRequest } from "../middlewares/jwt.middleware";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { recordAdminAction } from "../services/adminAuditLog";
import mongoose from "mongoose";

/**
 * Mobile: Raise a dispute for a booking
 * @route POST /api/v1/disputes
 */
export const raiseDispute = asyncHandler(async (req: AuthRequest, res) => {
    const { bookingId, reason, description, amountDisputed = 0, proofImages = [] } = req.body;
    const userId = req.tokenPayload?.id;

    if (!bookingId || !reason || !description) {
        throw new BadRequestError("Booking ID, reason, and description are required");
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
        throw new NotFoundError("Booking not found");
    }

    // Verify user is part of the booking
    const isCustomer = booking.customer.toString() === userId;
    const isWorker = booking.worker.toString() === userId;

    if (!isCustomer && !isWorker) {
        throw new UnauthorizedError("You are not authorized to raise a dispute for this booking");
    }

    // Check if a dispute already exists for this booking
    const existingDispute = await Dispute.findOne({ booking: bookingId });
    if (existingDispute) {
        throw new BadRequestError("A dispute has already been raised for this booking");
    }

    const raisedByType = isCustomer ? 'customer' : 'worker';

    const dispute = await Dispute.create({
        booking: bookingId,
        customer: booking.customer,
        worker: booking.worker,
        raisedBy: new mongoose.Types.ObjectId(userId),
        raisedByType,
        reason,
        description,
        amountDisputed: amountDisputed || 0,
        proofImages
    });

    return successResponse(res, 201, "Dispute raised successfully", dispute);
});

/**
 * Mobile: Get disputes involving the logged-in client or worker
 * @route GET /api/v1/disputes/my
 */
export const getMyDisputes = asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.tokenPayload?.id;
    const userType = req.tokenPayload?.type;

    if (!userId) {
        throw new UnauthorizedError("Authentication credentials not found");
    }

    const query = userType === 'worker' ? { worker: userId } : { customer: userId };

    const disputes = await Dispute.find(query)
        .populate('booking')
        .populate('customer', 'fullName phone profileImage')
        .populate('worker', 'fullName phone profileImage')
        .sort({ createdAt: -1 });

    return successResponse(res, 200, "Disputes fetched successfully", disputes);
});

/**
 * Admin: Get all disputes with query filters & pagination
 * @route GET /api/v1/admin/disputes
 */
export const getAllDisputes = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { status, reason, raisedByType, page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};
    if (status) query.status = status;
    if (reason) query.reason = reason;
    if (raisedByType) query.raisedByType = raisedByType;

    const total = await Dispute.countDocuments(query);
    const disputes = await Dispute.find(query)
        .populate('booking')
        .populate('customer', 'fullName phone profileImage')
        .populate('worker', 'fullName phone profileImage')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum);

    return paginatedResponse(res, 200, "Disputes fetched successfully", disputes, pageNum, limitNum, total);
});

/**
 * Admin: Get dispute details
 * @route GET /api/v1/admin/disputes/:id
 */
export const getDisputeDetails = asyncHandler(async (req: AdminAuthRequest, res) => {
    const dispute = await Dispute.findById(req.params.id)
        .populate('booking')
        .populate('customer', 'fullName phone email profileImage address city')
        .populate('worker', 'fullName phone email profileImage category hourlyRate city')
        .populate('resolvedBy', 'fullName email');

    if (!dispute) {
        throw new NotFoundError("Dispute not found");
    }

    return successResponse(res, 200, "Dispute details fetched successfully", dispute);
});

/**
 * Admin: Resolve or update dispute status
 * @route PATCH /api/v1/admin/disputes/:id/resolve
 */
export const resolveDispute = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { status, adminNotes, resolutionDetails, refundAmount = 0 } = req.body;
    const adminId = req.admin?._id;

    if (!status || !['resolved', 'dismissed', 'under_review'].includes(status)) {
        throw new BadRequestError("Valid status ('resolved', 'dismissed', 'under_review') is required");
    }

    const dispute = await Dispute.findById(id);
    if (!dispute) {
        throw new NotFoundError("Dispute not found");
    }

    dispute.status = status;
    if (adminNotes !== undefined) dispute.adminNotes = adminNotes;
    if (resolutionDetails !== undefined) dispute.resolutionDetails = resolutionDetails;

    if (status === 'resolved' || status === 'dismissed') {
        dispute.resolvedBy = adminId ? new mongoose.Types.ObjectId(adminId) : undefined;
        dispute.resolvedAt = new Date();
    }

    // Process refund if specified and status is resolved
    if (status === 'resolved' && refundAmount > 0) {
        // Adjust worker wallet: deduct the refundAmount from worker wallet
        const wallet = await WorkerWallet.findOne({ worker: dispute.worker });
        if (wallet) {
            const balanceBefore = wallet.balance;
            wallet.balance = Math.max(0, wallet.balance - refundAmount);
            wallet.totalCommissionDeducted += refundAmount; // Deduct and log commission deductor
            await wallet.save();

            const actorId = adminId ? new mongoose.Types.ObjectId(adminId) : new mongoose.Types.ObjectId();

            await WalletTransaction.create({
                wallet: wallet._id,
                worker: dispute.worker,
                type: 'adjustment',
                amount: refundAmount,
                balanceBefore,
                balanceAfter: wallet.balance,
                description: `Dispute Resolution Refund deduction (Dispute ID: ${dispute._id}): ${resolutionDetails || 'Deducted by admin'}`,
                performedBy: {
                    actor: actorId,
                    actorType: 'admin'
                }
            });
        }
    }

    await dispute.save();

    // Record system audit log
    await recordAdminAction(req, {
        action: `dispute.${status}`,
        entityType: 'dispute',
        entityId: dispute._id.toString(),
        reason: adminNotes || `Dispute ${status} by Admin`,
        metadata: {
            booking: dispute.booking?.toString(),
            customer: dispute.customer?.toString(),
            worker: dispute.worker?.toString(),
            refundAmount
        }
    });

    return successResponse(res, 200, `Dispute updated to ${status} successfully`, dispute);
});
