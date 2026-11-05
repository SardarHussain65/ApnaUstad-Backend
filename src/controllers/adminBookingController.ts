import Booking from "../models/Booking";
import Payment from "../models/Payment";
import JobPost from "../models/JobPost";
import User from "../models/User";
import Worker from "../models/Workers";
import WorkerWallet from "../models/WorkerWallet";
import WalletTransaction from "../models/WalletTransaction";
import Message from "../models/Message";
import Dispute from "../models/Dispute";
import Review from "../models/Reviews";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { BadRequestError, NotFoundError } from "../utils/ApiError";
import mongoose from "mongoose";
import { syncPaymentForBookingStatus } from "../services/paymentLedgerService";
import { releaseCommissionReservation } from "../services/commissionReservationService";
import { getOrCreateWallet, calculateCommissionAmount } from "../services/workerWalletService";
import { recordAdminAction } from "../services/adminAuditLog";
import { getIO } from "../sockets/socketManager";
import { emitBookingEvent } from "../sockets/handlers/booking.handler";

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Get all bookings
 * @route GET /api/v1/admin/bookings
 */
export const getAllBookings = asyncHandler(async (req: AdminAuthRequest, res) => {
    const parsedPage = parseInt(req.query.page as string, 10);
    const parsedLimit = parseInt(req.query.limit as string, 10);
    const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const limit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 10 : Math.min(parsedLimit, 200);
    const status = req.query.status as string;
    const workerId = req.query.workerId as string;
    const customerId = req.query.customerId as string;
    const search = req.query.search as string;
    const paymentStatus = req.query.paymentStatus as string;
    const bookingType = req.query.bookingType as string;
    const dateFrom = req.query.dateFrom as string;
    const dateTo = req.query.dateTo as string;

    const query: any = {};
    if (status && status !== 'undefined') {
        query.status = status;
    }
    if (workerId && workerId !== 'undefined') {
        if (!mongoose.Types.ObjectId.isValid(workerId)) {
            throw new BadRequestError("Invalid workerId");
        }
        query.worker = workerId;
    }
    if (customerId && customerId !== 'undefined') {
        if (!mongoose.Types.ObjectId.isValid(customerId)) {
            throw new BadRequestError("Invalid customerId");
        }
        query.customer = customerId;
    }
    if (bookingType && bookingType !== 'undefined') {
        query.bookingType = bookingType;
    }
    if (req.query.fraudFlagged === 'true') {
        query['fraudSignals.isFlaggedForAudit'] = true;
    }
    if (req.query.hasReductionRequest === 'true') {
        query['customerReductionRequest.status'] = 'pending';
    }
    if (dateFrom || dateTo) {
        query.scheduledDate = {};
        if (dateFrom) {
            const parsedDateFrom = new Date(dateFrom);
            if (Number.isNaN(parsedDateFrom.getTime())) {
                throw new BadRequestError("Invalid dateFrom");
            }
            query.scheduledDate.$gte = parsedDateFrom;
        }
        if (dateTo) {
            const parsedDateTo = new Date(dateTo);
            if (Number.isNaN(parsedDateTo.getTime())) {
                throw new BadRequestError("Invalid dateTo");
            }
            parsedDateTo.setHours(23, 59, 59, 999);
            query.scheduledDate.$lte = parsedDateTo;
        }
    }
    if (paymentStatus && paymentStatus !== 'undefined') {
        const bookingIds = await Payment.find({ status: paymentStatus }).distinct('booking');
        query._id = { $in: bookingIds };
    }
    if (search) {
        const searchRegex = new RegExp(escapeRegex(search), 'i');
        const [customers, workers] = await Promise.all([
            User.find({ $or: [{ fullName: searchRegex }, { phone: searchRegex }] }).select('_id'),
            Worker.find({ $or: [{ fullName: searchRegex }, { phone: searchRegex }] }).select('_id')
        ]);
        const searchQuery: any[] = [
            { category: searchRegex },
            { description: searchRegex },
            { customer: { $in: customers.map(customer => customer._id) } },
            { worker: { $in: workers.map(worker => worker._id) } }
        ];
        if (mongoose.Types.ObjectId.isValid(search)) {
            searchQuery.push({ _id: new mongoose.Types.ObjectId(search) });
        }
        query.$and = [...(query.$and || []), { $or: searchQuery }];
    }

    const total = await Booking.countDocuments(query);
    const bookings = await Booking.find(query)
        .populate('customer', 'fullName phone email city address location profileImage')
        .populate('worker', 'fullName phone email city address location category profileImage isAvailable lastOnlineAt')
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 });
    const payments = await Payment.find({ booking: { $in: bookings.map(booking => booking._id) } });
    const paymentByBooking = new Map(payments.map(payment => [payment.booking.toString(), payment.toObject()]));
    const rows = bookings.map(booking => ({
        ...booking.toObject(),
        payment: paymentByBooking.get(booking._id.toString()) || null
    }));

    return paginatedResponse(res, 200, "Bookings fetched successfully", rows, page, limit, total);
});

/**
 * Get booking details
 * @route GET /api/v1/admin/bookings/:id
 */
export const getBookingDetails = asyncHandler(async (req: AdminAuthRequest, res) => {
    const booking = await Booking.findById(req.params.id)
        .populate('customer', 'fullName phone email city address location profileImage isActive')
        .populate('worker', 'fullName phone email city address location category hourlyRate rating totalReviews profileImage isVerified isAvailable lastOnlineAt')
        .populate('jobPost', 'title category description address location urgency pricing status createdAt')
        .populate('acceptedBid', 'proposedPrice priceMode message rateBasis helperCount createdAt');

    if (!booking) throw new NotFoundError("Booking not found");

    const [payment, dispute, review] = await Promise.all([
        Payment.findOne({ booking: booking._id }).lean(),
        Dispute.findOne({ booking: booking._id }).lean(),
        Review.findOne({ booking: booking._id }).lean(),
    ]);

    return successResponse(res, 200, "Booking fetched successfully", {
        ...booking.toObject(),
        payment,
        dispute,
        review,
    });
});

/**
 * Force update booking status (admin override)
 * @route PATCH /api/v1/admin/bookings/:id/status
 */
export const updateBookingStatus = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { status: nextStatus, cancelReason } = req.body;

    if (!nextStatus) {
        throw new BadRequestError("Status is required");
    }

    const validStatuses = ['pending', 'accepted', 'ongoing', 'completed', 'cancelled'];
    if (!validStatuses.includes(nextStatus)) {
        throw new BadRequestError(`Invalid status: ${nextStatus}`);
    }

    const booking = await Booking.findById(id);
    if (!booking) {
        throw new NotFoundError("Booking not found");
    }

    booking.status = nextStatus;

    if (nextStatus === 'cancelled') {
        booking.cancelledBy = 'admin';
        booking.cancelReason = cancelReason || 'Admin force cancel';
    }

    await booking.save();

    // Release commission reservation if transitioned to cancelled
    if (nextStatus === 'cancelled') {
        await releaseCommissionReservation(booking._id).catch(err => {});
    }

    // Sync payments and linked job posts
    await syncPaymentForBookingStatus(booking).catch(err => {});
    
    if (booking.jobPost) {
        const linkedStatus = nextStatus === 'completed'
            ? 'closed'
            : nextStatus === 'cancelled'
                ? 'cancelled'
                : null;
        if (linkedStatus) {
            await JobPost.findByIdAndUpdate(booking.jobPost, { $set: { status: linkedStatus } }).catch(err => {});
        }
    }

    // Emit socket event to notify other parties
    try {
        const io = getIO();
        emitBookingEvent(io, booking, nextStatus === 'cancelled' ? 'booking:cancelled' : `booking:${nextStatus}`);
    } catch (err) {}

    return successResponse(res, 200, `Booking status force updated to ${nextStatus}`, booking);
});

/**
 * Cancel booking (admin override)
 * @route POST /api/v1/admin/bookings/:id/cancel
 */
export const cancelBooking = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) {
        throw new NotFoundError("Booking not found");
    }

    if (booking.status === 'completed' || booking.status === 'cancelled') {
        throw new BadRequestError(`Booking is already in a terminal state: ${booking.status}`);
    }

    booking.status = 'cancelled';
    booking.cancelledBy = 'admin';
    booking.cancelReason = reason || 'Admin cancelled';
    await booking.save();

    await releaseCommissionReservation(booking._id).catch(err => {});
    await syncPaymentForBookingStatus(booking).catch(err => {});

    if (booking.jobPost) {
        await JobPost.findByIdAndUpdate(booking.jobPost, { $set: { status: 'cancelled' } }).catch(err => {});
    }

    // Emit socket event
    try {
        const io = getIO();
        emitBookingEvent(io, booking, 'booking:cancelled');
    } catch (err) {}

    return successResponse(res, 200, "Booking cancelled successfully by Admin override", booking);
});

/**
 * Read-only booking chat for admin investigations
 * @route GET /api/v1/admin/bookings/:id/messages
 */
export const getAdminBookingMessages = asyncHandler(async (req: AdminAuthRequest, res) => {
    const booking = await Booking.findById(req.params.id).select('_id');
    if (!booking) throw new NotFoundError("Booking not found");

    const messages = await Message.find({ booking: booking._id })
        .sort({ createdAt: 1 })
        .limit(200)
        .lean();

    return successResponse(res, 200, "Booking messages fetched successfully", messages);
});

/**
 * Admin resolves a customer price reduction request.
 * If approved, updates booking amount and refunds excess commission back to the worker's wallet.
 * @route PATCH /api/v1/admin/bookings/:id/resolve-reduction
 */
export const resolveCustomerReductionRequest = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { action, adminNotes } = req.body; // action: 'approve' | 'reject'

    if (!action || (action !== 'approve' && action !== 'reject')) {
        throw new BadRequestError("Action must be 'approve' or 'reject'");
    }

    const booking = await Booking.findById(id);
    if (!booking) throw new NotFoundError("Booking not found");

    if (!booking.customerReductionRequest || booking.customerReductionRequest.status !== 'pending') {
        throw new BadRequestError("No pending customer price reduction request for this booking");
    }

    const previousAmount = Number(booking.totalAmount || 0);
    const requestedAmount = Number(booking.customerReductionRequest.requestedAmount);
    let refundAmount = 0;

    if (action === 'approve') {
        const previousCommission = Number(booking.platformFee || 0);
        const newCommission = await calculateCommissionAmount(requestedAmount);

        // If commission was already deducted at ongoing, refund difference to worker wallet
        if (booking.commissionDeducted && previousCommission > newCommission) {
            refundAmount = previousCommission - newCommission;
            const workerWallet = await getOrCreateWallet(booking.worker);
            const bookingRef = String(booking._id).slice(-6).toUpperCase();

            await WorkerWallet.findByIdAndUpdate(workerWallet._id, {
                $inc: {
                    balance: refundAmount,
                    totalCommissionDeducted: -refundAmount
                }
            });

            await WalletTransaction.create({
                wallet: workerWallet._id,
                worker: booking.worker,
                type: 'refund',
                amount: refundAmount,
                balanceBefore: workerWallet.balance,
                balanceAfter: workerWallet.balance + refundAmount,
                description: `Refund excess commission for Job #${bookingRef} due to approved scope reduction to Rs. ${requestedAmount}`,
                reference: { booking: booking._id },
                performedBy: { actor: req.admin?._id, actorType: 'admin' }
            });
        }

        booking.subtotal = requestedAmount;
        booking.totalAmount = requestedAmount;
        booking.platformFee = newCommission;
        if (booking.agreement) {
            booking.agreement.agreedPrice = requestedAmount;
            booking.agreement.cashDue = requestedAmount - Number(booking.agreement.discountAmount || 0);
            booking.agreement.commissionAmount = newCommission;
            booking.agreement.workerNetIncome = requestedAmount - newCommission;
        }

        booking.customerReductionRequest.status = 'approved';
        booking.customerReductionRequest.resolvedAt = new Date();
        booking.customerReductionRequest.adminNotes = adminNotes || 'Approved by Admin';
    } else {
        booking.customerReductionRequest.status = 'rejected';
        booking.customerReductionRequest.resolvedAt = new Date();
        booking.customerReductionRequest.adminNotes = adminNotes || 'Rejected by Admin';
    }

    await booking.save();

    await recordAdminAction(req, {
        action: action === 'approve' ? 'APPROVE_PRICE_REDUCTION' : 'REJECT_PRICE_REDUCTION',
        entityType: 'booking',
        entityId: booking._id.toString(),
        reason: adminNotes || `Admin ${action}d price reduction from Rs. ${previousAmount} to Rs. ${requestedAmount}`,
        metadata: {
            previousAmount,
            requestedAmount,
            refundAmount,
            action
        }
    });

    return successResponse(res, 200, `Price reduction request ${action}d successfully`, booking);
});

/**
 * Admin resolves a fraud alert flag on a booking.
 * Can dismiss as false alarm or penalize the worker wallet.
 * @route PATCH /api/v1/admin/bookings/:id/resolve-fraud
 */
export const resolveFraudFlag = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { action, penaltyAmount, reason } = req.body; // action: 'dismiss' | 'penalize'

    if (!action || (action !== 'dismiss' && action !== 'penalize')) {
        throw new BadRequestError("Action must be 'dismiss' or 'penalize'");
    }

    if (!reason || String(reason).trim().length < 5) {
        throw new BadRequestError("A detailed reason (at least 5 characters) is required");
    }

    const booking = await Booking.findById(id);
    if (!booking) throw new NotFoundError("Booking not found");

    const penalty = Number(penaltyAmount || 0);

    if (action === 'penalize') {
        if (penalty > 0) {
            const workerWallet = await getOrCreateWallet(booking.worker);
            const bookingRef = String(booking._id).slice(-6).toUpperCase();

            await WorkerWallet.findByIdAndUpdate(workerWallet._id, {
                $inc: {
                    balance: -penalty,
                    totalCommissionDeducted: penalty
                }
            });

            await WalletTransaction.create({
                wallet: workerWallet._id,
                worker: booking.worker,
                type: 'adjustment',
                amount: penalty,
                balanceBefore: workerWallet.balance,
                balanceAfter: workerWallet.balance - penalty,
                description: `Admin fraud penalty for Job #${bookingRef}: ${reason}`,
                reference: { booking: booking._id },
                performedBy: { actor: req.admin?._id, actorType: 'admin' }
            });
        }
    }

    booking.fraudSignals = booking.fraudSignals || {};
    booking.fraudSignals.isFlaggedForAudit = false;
    booking.fraudSignals.flagReason = `${booking.fraudSignals.flagReason || ''} [Resolved by Admin (${action}): ${reason}]`;

    await booking.save();

    await recordAdminAction(req, {
        action: action === 'penalize' ? 'PENALIZE_WORKER_FRAUD' : 'DISMISS_FRAUD_FLAG',
        entityType: 'booking',
        entityId: booking._id.toString(),
        reason: String(reason).trim(),
        metadata: {
            action,
            penaltyAmount: penalty,
            workerId: booking.worker.toString()
        }
    });

    return successResponse(res, 200, `Fraud alert ${action}d successfully`, booking);
});
