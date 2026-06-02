// src/controllers/disputeController.ts
import Dispute from "../models/Dispute";
import Booking from "../models/Booking";
import User from "../models/User";
import Worker from "../models/Workers";
import WorkerWallet from "../models/WorkerWallet";
import WalletTransaction from "../models/WalletTransaction";
import Payment from "../models/Payment";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../utils/ApiError";
import { AuthRequest } from "../middlewares/jwt.middleware";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { recordAdminAction } from "../services/adminAuditLog";
import { creditUserWallet } from "../services/userWalletService";
import { sendNotificationToRecipient } from "../services/notificationHelper";
import { releaseCommissionReservation, settleCommissionReservation } from "../services/commissionReservationService";
import logger from "../config/logger";
import mongoose from "mongoose";

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    const { status, adminNotes, resolutionDetails, refundAmount = 0 } = req.body;
    const adminId = req.admin?._id;

    if (!status || !['resolved', 'dismissed', 'under_review'].includes(status)) {
        throw new BadRequestError("Valid status ('resolved', 'dismissed', 'under_review') is required");
    }

    const session = await mongoose.startSession();
    let dispute: any = null;

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
                    // Process refund if specified
                    if (refundAmount > 0) {
                        if (refundAmount > dispute.amountDisputed) {
                            const error = new Error(`Refund amount cannot exceed disputed amount of Rs. ${dispute.amountDisputed}`);
                            (error as any).statusCode = 400;
                            throw error;
                        }

                        // Adjust worker wallet: deduct the refundAmount from worker wallet atomically
                        const workerWallet = await WorkerWallet.findOneAndUpdate(
                            { worker: dispute.worker },
                            { $inc: { balance: -refundAmount, totalCommissionDeducted: refundAmount } },
                            { new: true, session }
                        );

                        if (workerWallet) {
                            const actorId = adminId ? new mongoose.Types.ObjectId(adminId) : new mongoose.Types.ObjectId();
                            await WalletTransaction.create([{
                                wallet: workerWallet._id,
                                worker: dispute.worker,
                                type: 'adjustment',
                                amount: refundAmount,
                                balanceBefore: workerWallet.balance + refundAmount,
                                balanceAfter: workerWallet.balance,
                                description: `Dispute Resolution Refund deduction (Dispute ID: ${dispute._id}): ${resolutionDetails || 'Deducted by admin'}`,
                                performedBy: {
                                    actor: actorId,
                                    actorType: 'admin'
                                },
                                reference: {
                                    booking: booking._id
                                }
                            }], { session });

                            // Credit the customer's wallet balance atomically
                            await creditUserWallet(
                                dispute.customer,
                                refundAmount,
                                { actor: actorId, actorType: 'admin' },
                                `Dispute Resolution Refund credit (Dispute ID: ${dispute._id}): ${resolutionDetails || 'Credited by admin'}`,
                                { booking: booking._id, dispute: dispute._id },
                                session
                            );
                        }
                    }

                    // Release platform commission reservation back to the worker
                    await releaseCommissionReservation(booking._id, { session });

                    // Update payment status to refunded/cancelled
                    if (payment) {
                        payment.status = refundAmount >= dispute.amountDisputed ? 'cancelled' : 'refunded';
                        payment.bookingStatusSnapshot = booking.status;
                        await payment.save({ session });
                    }

                    // Update booking payment status
                    booking.paymentStatus = 'refunded';
                    await booking.save({ session });

                } else if (status === 'dismissed') {
                    // Dispute is dismissed: settle platform commission reservation
                    await settleCommissionReservation(
                        booking.worker,
                        booking._id,
                        payment ? payment._id : new mongoose.Types.ObjectId(),
                        Number(booking.agreement?.commissionAmount ?? booking.platformFee ?? 0),
                        { session }
                    );

                    // Ensure payment is completed / paid
                    if (payment) {
                        payment.status = 'paid';
                        payment.bookingStatusSnapshot = booking.status;
                        payment.workerLedgerApplied = true;
                        await payment.save({ session });
                    }

                    // Settle booking payment status
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

    // Record system audit log outside transaction
    if (dispute) {
        try {
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

            // Dispatch communications and push notification loops
            const bIdStr = dispute.booking.toString().slice(-6).toUpperCase();
            
            if (status === 'under_review') {
                await sendNotificationToRecipient(
                    dispute.customer,
                    'user',
                    'Dispute Under Investigation',
                    `Your dispute raised for booking #${bIdStr} is now under investigation by ApnaUstad moderators.`
                );
                await sendNotificationToRecipient(
                    dispute.worker,
                    'worker',
                    'Dispute Under Investigation',
                    `A dispute raised for your booking #${bIdStr} is now under investigation by ApnaUstad moderators.`
                );
            } else if (status === 'resolved') {
                await sendNotificationToRecipient(
                    dispute.customer,
                    'user',
                    'Dispute Resolved - Refund Credited',
                    `Congratulations! Your dispute for booking #${bIdStr} has been resolved in your favor. A refund of Rs. ${refundAmount.toLocaleString()} has been credited to your wallet.`
                );
                await sendNotificationToRecipient(
                    dispute.worker,
                    'worker',
                    'Dispute Resolved - Wallet Adjusted',
                    `Moderation completed: Dispute for booking #${bIdStr} has been resolved. A deduction of Rs. ${refundAmount.toLocaleString()} has been made from your worker balance.`
                );
            } else if (status === 'dismissed') {
                await sendNotificationToRecipient(
                    dispute.customer,
                    'user',
                    'Dispute Dismissed',
                    `Moderation completed: Dispute for booking #${bIdStr} has been dismissed after investigation.`
                );
                await sendNotificationToRecipient(
                    dispute.worker,
                    'worker',
                    'Dispute Dismissed - Funds Released',
                    `Good news! The dispute raised for booking #${bIdStr} has been dismissed by moderators. Platform reservation has been successfully settled.`
                );
            }
        } catch (notifErr: any) {
            logger.error("Failed to execute notification loops on resolveDispute:", notifErr);
        }
    }

    return successResponse(res, 200, `Dispute updated to ${status} successfully`, dispute);
});
