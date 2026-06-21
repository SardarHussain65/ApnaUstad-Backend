// src/controllers/disputeController.ts
import Dispute from "../models/Dispute";
import Booking from "../models/Booking";
import User from "../models/User";
import Worker from "../models/Workers";
import Payment from "../models/Payment";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../utils/ApiError";
import { AuthRequest } from "../middlewares/jwt.middleware";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { recordAdminAction } from "../services/adminAuditLog";
import { sendNotificationToRecipient } from "../services/notificationHelper";
import { releaseCommissionReservation, settleCommissionReservation } from "../services/commissionReservationService";
import logger from "../config/logger";
import mongoose from "mongoose";

import { raiseDisputeSchema } from "../validations/dispute.validation";
import { resolveDisputeSchema } from "../validations/disputeResolution.validation";
import {
    evaluateDisputeEligibility,
    getBookingJobAmount,
    notifyAdminsAboutDispute,
    notifyPartiesAboutNewDispute,
} from "../services/disputeService";
import {
    applyDisputeModerationAfterResolve,
    applyDisputeWalletActions,
    buildModerationSummary,
} from "../services/disputeResolutionService";

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Mobile: Raise a dispute for a booking
 * @route POST /api/v1/disputes
 */
export const raiseDispute = asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.tokenPayload?.id;
    const userType = req.tokenPayload?.type;

    if (!userId) {
        throw new UnauthorizedError("Authentication credentials not found");
    }

    const validation = raiseDisputeSchema.safeParse(req.body);
    if (!validation.success) {
        throw new BadRequestError(validation.error.issues[0]?.message || "Invalid dispute payload");
    }

    const { bookingId, reason, description, proofImages } = validation.data;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
        throw new NotFoundError("Booking not found");
    }

    const eligibility = await evaluateDisputeEligibility({ booking, userId, userType });
    if (!eligibility.canRaiseDispute) {
        throw new BadRequestError(eligibility.canRaiseDisputeReason || "You cannot raise a dispute for this booking");
    }

    const isCustomer = booking.customer.toString() === userId;
    const raisedByType = isCustomer ? 'customer' : 'worker';
    const jobAmount = getBookingJobAmount(booking);

    const dispute = await Dispute.create({
        booking: bookingId,
        customer: booking.customer,
        worker: booking.worker,
        raisedBy: new mongoose.Types.ObjectId(userId),
        raisedByType,
        reason,
        description,
        amountDisputed: jobAmount,
        proofImages,
    });

    await Promise.allSettled([
        notifyPartiesAboutNewDispute(dispute, booking),
        notifyAdminsAboutDispute(dispute, booking),
    ]);

    return successResponse(res, 201, "Complaint submitted successfully", dispute);
});

/**
 * Mobile: Get dispute for a specific booking (if any)
 * @route GET /api/v1/disputes/booking/:bookingId
 */
export const getDisputeByBooking = asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.tokenPayload?.id;
    const userType = req.tokenPayload?.type;
    const { bookingId } = req.params;

    if (!userId) {
        throw new UnauthorizedError("Authentication credentials not found");
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
        throw new NotFoundError("Booking not found");
    }

    const isCustomer = booking.customer.toString() === userId;
    const isWorker = booking.worker.toString() === userId;
    if (!isCustomer && !isWorker && userType !== 'admin') {
        throw new UnauthorizedError("You are not authorized to view disputes for this booking");
    }

    const dispute = await Dispute.findOne({ booking: bookingId })
        .populate('booking', 'category status paymentStatus totalAmount completedAt')
        .sort({ createdAt: -1 });

    const eligibility = await evaluateDisputeEligibility({ booking, userId, userType });

    return successResponse(res, 200, "Booking dispute context fetched", {
        dispute,
        eligibility,
    });
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
    const { status, reason, raisedByType, search, page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 10, 100);
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};
    if (status) query.status = status;
    if (reason) query.reason = reason;
    if (raisedByType) query.raisedByType = raisedByType;
    if (search) {
        const searchRegex = new RegExp(escapeRegex(search as string), 'i');
        const [customers, workers, bookings] = await Promise.all([
            User.find({ $or: [{ fullName: searchRegex }, { phone: searchRegex }] }).select('_id'),
            Worker.find({ $or: [{ fullName: searchRegex }, { phone: searchRegex }] }).select('_id'),
            Booking.find({ category: searchRegex }).select('_id')
        ]);
        query.$or = [
            { customer: { $in: customers.map(customer => customer._id) } },
            { worker: { $in: workers.map(worker => worker._id) } },
            { booking: { $in: bookings.map(booking => booking._id) } },
            { description: searchRegex },
            { reason: searchRegex }
        ];
        if (mongoose.Types.ObjectId.isValid(search as string)) {
            query.$or.push({ _id: new mongoose.Types.ObjectId(search as string) });
        }
    }

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

    const validation = resolveDisputeSchema.safeParse(req.body);
    if (!validation.success) {
        throw new BadRequestError(validation.error.issues[0]?.message || "Invalid resolution payload");
    }

    const {
        status,
        adminNotes,
        resolutionDetails,
        refundAmount = 0,
        moderation = {
            warnCustomer: false,
            warnWorker: false,
            workerPenalty: 0,
            blockCustomer: false,
            blockWorker: false,
            blockReason: '',
        },
    } = validation.data;
    const adminId = req.admin?._id;

    if (status === 'dismissed' && refundAmount > 0) {
        throw new BadRequestError('Refund is only available when ruling in the customer\'s favour');
    }
    if (status === 'dismissed' && (moderation.warnWorker || moderation.blockWorker || (moderation.workerPenalty || 0) > 0)) {
        throw new BadRequestError('Ustad penalties apply only when the complaint is upheld (resolved)');
    }
    if (status === 'resolved' && (moderation.warnCustomer || moderation.blockCustomer)) {
        throw new BadRequestError('Customer penalties apply when the complaint is dismissed');
    }

    const session = await mongoose.startSession();
    let dispute: any = null;
    let walletOutcome = { customerRefund: 0, workerPenalty: 0 };

    try {
        await session.withTransaction(async () => {
            dispute = await Dispute.findById(id).session(session);
            if (!dispute) {
                const error = new Error("Dispute not found");
                (error as any).statusCode = 404;
                throw error;
            }

            dispute.status = status;
            if (adminNotes !== undefined) dispute.adminNotes = adminNotes;
            if (resolutionDetails !== undefined) dispute.resolutionDetails = resolutionDetails;

            if (status === 'resolved' || status === 'dismissed') {
                dispute.resolvedBy = adminId ? new mongoose.Types.ObjectId(adminId) : undefined;
                dispute.resolvedAt = new Date();
            }

            const booking = await Booking.findById(dispute.booking).session(session);
            if (booking) {
                const payment = await Payment.findOne({ booking: booking._id }).session(session);

                if (status === 'resolved') {
                    walletOutcome = await applyDisputeWalletActions({
                        dispute,
                        booking,
                        refundAmount,
                        workerPenalty: moderation.workerPenalty || 0,
                        adminId: adminId ? new mongoose.Types.ObjectId(adminId) : undefined,
                        resolutionDetails,
                        session,
                    });

                    await releaseCommissionReservation(booking._id, { session });

                    if (payment) {
                        payment.status = walletOutcome.customerRefund >= dispute.amountDisputed ? 'cancelled' : 'refunded';
                        payment.bookingStatusSnapshot = booking.status;
                        await payment.save({ session });
                    }

                    booking.paymentStatus = 'refunded';
                    await booking.save({ session });

                } else if (status === 'dismissed') {
                    await settleCommissionReservation(
                        booking.worker,
                        booking._id,
                        payment ? payment._id : new mongoose.Types.ObjectId(),
                        Number(booking.agreement?.commissionAmount ?? booking.platformFee ?? 0),
                        { session }
                    );

                    if (payment) {
                        payment.status = 'paid';
                        payment.bookingStatusSnapshot = booking.status;
                        payment.workerLedgerApplied = true;
                        await payment.save({ session });
                    }

                    booking.paymentStatus = 'paid';
                    await booking.save({ session });
                }
            }

            await dispute.save({ session });
        });
    } catch (error: any) {
        logger.error("Error inside resolveDispute transaction:", error);
        throw new BadRequestError(error.message || "Failed to resolve dispute cleanly");
    } finally {
        await session.endSession();
    }

    let moderationApplied = null;
    if (dispute) {
        try {
            const bIdStr = dispute.booking.toString().slice(-6).toUpperCase();
            const bookingId = dispute.booking.toString();
            const disputeNotifyOptions = {
                type: 'dispute' as const,
                icon: 'scale',
                color: '#FF3B30',
                bookingId,
            };

            if (status === 'under_review') {
                await recordAdminAction(req, {
                    action: 'dispute.under_review',
                    entityType: 'dispute',
                    entityId: dispute._id.toString(),
                    reason: adminNotes || 'Marked under investigation',
                    metadata: { booking: bookingId },
                });
                await sendNotificationToRecipient(
                    dispute.customer,
                    'user',
                    'Complaint under investigation',
                    `Your report for booking #${bIdStr} is being reviewed by ApnaUstad.`,
                    { type: 'dispute', bookingId },
                    disputeNotifyOptions,
                );
                await sendNotificationToRecipient(
                    dispute.worker,
                    'worker',
                    'Complaint under investigation',
                    `A report on booking #${bIdStr} is being reviewed by ApnaUstad.`,
                    { type: 'dispute', bookingId },
                    disputeNotifyOptions,
                );
            } else if (status === 'resolved' || status === 'dismissed') {
                moderationApplied = await applyDisputeModerationAfterResolve({
                    req,
                    dispute,
                    moderation,
                    resolutionDetails: resolutionDetails || '',
                    bookingRef: bIdStr,
                    bookingId,
                });

                moderationApplied.customerRefund = walletOutcome.customerRefund;
                moderationApplied.workerPenalty = walletOutcome.workerPenalty;

                dispute.moderationApplied = moderationApplied;
                await dispute.save();

                const modSummary = buildModerationSummary(moderationApplied);

                await recordAdminAction(req, {
                    action: `dispute.${status}`,
                    entityType: 'dispute',
                    entityId: dispute._id.toString(),
                    reason: adminNotes || `Dispute ${status} by Admin`,
                    metadata: {
                        booking: bookingId,
                        customer: dispute.customer?.toString(),
                        worker: dispute.worker?.toString(),
                        refundAmount: walletOutcome.customerRefund,
                        workerPenalty: walletOutcome.workerPenalty,
                        moderation: moderationApplied,
                        summary: modSummary,
                    },
                });

                if (status === 'resolved') {
                    const refundText = walletOutcome.customerRefund > 0
                        ? ` Rs. ${walletOutcome.customerRefund.toLocaleString()} credited to your wallet.`
                        : '';
                    await sendNotificationToRecipient(
                        dispute.customer,
                        'user',
                        'Complaint upheld',
                        `Your report for booking #${bIdStr} was upheld.${refundText} ${resolutionDetails || ''}`.trim(),
                        { type: 'dispute', bookingId },
                        { ...disputeNotifyOptions, color: '#34C759' },
                    );
                    const debitTotal = walletOutcome.customerRefund + walletOutcome.workerPenalty;
                    const workerMsg = debitTotal > 0
                        ? ` Rs. ${debitTotal.toLocaleString()} adjusted from your wallet.`
                        : '';
                    await sendNotificationToRecipient(
                        dispute.worker,
                        'worker',
                        'Complaint upheld against Ustad',
                        `Moderation on booking #${bIdStr} is complete.${workerMsg} ${modSummary !== 'no extra actions' ? `Actions: ${modSummary}.` : ''}`.trim(),
                        { type: 'dispute', bookingId },
                        disputeNotifyOptions,
                    );
                } else {
                    await sendNotificationToRecipient(
                        dispute.customer,
                        'user',
                        'Complaint not upheld',
                        `Your report for booking #${bIdStr} was reviewed and not upheld. ${resolutionDetails || ''}`.trim(),
                        { type: 'dispute', bookingId },
                        disputeNotifyOptions,
                    );
                    await sendNotificationToRecipient(
                        dispute.worker,
                        'worker',
                        'Complaint dismissed',
                        `Good news — the report on booking #${bIdStr} was dismissed. Payment can proceed normally.`,
                        { type: 'dispute', bookingId },
                        { ...disputeNotifyOptions, color: '#34C759' },
                    );
                }
            }
        } catch (notifErr: any) {
            logger.error("Failed to execute post-resolve dispute actions:", notifErr);
        }
    }

    return successResponse(res, 200, `Dispute updated to ${status} successfully`, dispute);
});
