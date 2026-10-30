// src/controllers/disputeController.ts
import Dispute, { type IDispute } from "../models/Dispute";
import Booking from "../models/Booking";
import User from "../models/User";
import Worker from "../models/Workers";
import Payment from "../models/Payment";
import Notification from "../models/Notifications";
import Admin from "../models/Admin";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../utils/ApiError";
import { AuthRequest } from "../middlewares/jwt.middleware";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { UploadRequest } from "../middlewares/multer.middleware";
import { recordAdminAction } from "../services/adminAuditLog";
import { sendNotificationToRecipient } from "../services/notificationHelper";
import { releaseCommissionReservation, settleCommissionReservation } from "../services/commissionReservationService";
import logger from "../config/logger";
import mongoose from "mongoose";

import { raiseDisputeSchema, disputeMessageSchema, withdrawDisputeSchema } from "../validations/dispute.validation";
import { resolveDisputeSchema } from "../validations/disputeResolution.validation";
import {
    ACTIVE_DISPUTE_STATUSES,
    DISPUTE_REASON_LABELS,
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
import {
    CLOSED_DISPUTE_STATUSES,
    emitDisputeUpdated,
    fetchDisputeMessages,
    getViewerRole,
    isDisputeClosed,
    markDisputeRead,
    postDisputeMessage,
    pushTimelineEvent,
    resolvePartyName,
    serializeDisputeForViewer,
    type DisputeViewerRole,
} from "../services/disputeRoomService";

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const assertValidId = (id: unknown, label = 'Dispute'): string => {
    if (typeof id !== 'string' || !mongoose.Types.ObjectId.isValid(id)) {
        throw new NotFoundError(`${label} not found`);
    }
    return id;
};

/** Load a dispute and confirm the authenticated user is the customer or Ustad on it. */
const loadDisputeForParty = async (req: AuthRequest): Promise<{ dispute: IDispute; role: DisputeViewerRole; userId: string }> => {
    const userId = req.tokenPayload?.id;
    if (!userId) throw new UnauthorizedError("Authentication credentials not found");
    assertValidId(req.params.id);

    const dispute = await Dispute.findById(req.params.id) as IDispute | null;
    if (!dispute) throw new NotFoundError("Complaint not found");

    const role = getViewerRole(dispute, userId);
    if (!role) throw new UnauthorizedError("You are not part of this complaint");
    return { dispute, role, userId };
};

const populateDisputeForParty = (query: any) => query
    .populate('booking', 'category status paymentStatus totalAmount completedAt scheduledDate scheduledTime address agreement')
    .populate('customer', 'fullName profileImage')
    .populate('worker', 'fullName profileImage category')
    .populate('resolvedBy', 'fullName');

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
    const raiserName = await resolvePartyName(raisedByType, userId);

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
        timeline: [{
            type: 'opened',
            actorType: raisedByType,
            actorName: raiserName,
            note: DISPUTE_REASON_LABELS[reason],
            at: new Date(),
        }],
    }) as IDispute;

    // Seed the Case Room so everyone sees the issue in context
    try {
        await postDisputeMessage({
            dispute,
            senderType: 'system',
            kind: 'system',
            content: `${raisedByType === 'customer' ? 'Customer' : 'Ustad'} reported: ${DISPUTE_REASON_LABELS[reason]}. Cash payment is on hold. Both sides can explain here — ApnaUstad Team will join to help.`,
            silent: true,
        });
    } catch (seedError) {
        logger.error("Failed to seed dispute case room:", seedError);
    }

    await Promise.allSettled([
        notifyPartiesAboutNewDispute(dispute, booking),
        notifyAdminsAboutDispute(dispute, booking),
    ]);
    emitDisputeUpdated(dispute);

    return successResponse(res, 201, "Complaint submitted successfully", dispute);
});

/**
 * Mobile: Upload evidence photos (customer or Ustad)
 * @route POST /api/v1/disputes/upload-evidence
 */
export const uploadDisputeEvidence = asyncHandler(async (req: UploadRequest, res) => {
    const imageUrls = req.uploadedImageUrls || [];
    if (!imageUrls.length) {
        throw new BadRequestError("No photos uploaded");
    }
    return successResponse(res, 200, "Evidence uploaded", { imageUrls });
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
        .sort({ createdAt: -1 }) as IDispute | null;

    const eligibility = await evaluateDisputeEligibility({ booking, userId, userType });
    const role: DisputeViewerRole = isCustomer ? 'customer' : 'worker';

    return successResponse(res, 200, "Booking dispute context fetched", {
        dispute: dispute ? await serializeDisputeForViewer(dispute, role) : null,
        eligibility,
    });
});

/**
 * Mobile: Get disputes involving the logged-in client or worker
 * @route GET /api/v1/disputes/my?scope=active|history|all
 */
export const getMyDisputes = asyncHandler(async (req: AuthRequest, res) => {
    const userId = req.tokenPayload?.id;
    const userType = req.tokenPayload?.type;
    const scope = String(req.query.scope || 'all');

    if (!userId) {
        throw new UnauthorizedError("Authentication credentials not found");
    }

    const role: DisputeViewerRole = userType === 'worker' ? 'worker' : 'customer';
    const query: Record<string, any> = role === 'worker' ? { worker: userId } : { customer: userId };
    if (scope === 'active') query.status = { $in: ACTIVE_DISPUTE_STATUSES };
    if (scope === 'history') query.status = { $in: CLOSED_DISPUTE_STATUSES };

    const disputes = await populateDisputeForParty(Dispute.find(query))
        .sort({ updatedAt: -1 }) as IDispute[];

    const data = await Promise.all(disputes.map((dispute) => serializeDisputeForViewer(dispute, role)));
    return successResponse(res, 200, "Disputes fetched successfully", data);
});

/**
 * Mobile: Case Room details
 * @route GET /api/v1/disputes/:id
 */
export const getDisputeForParty = asyncHandler(async (req: AuthRequest, res) => {
    const { role } = await loadDisputeForParty(req);
    const dispute = await populateDisputeForParty(Dispute.findById(req.params.id)) as IDispute;
    return successResponse(res, 200, "Complaint fetched", await serializeDisputeForViewer(dispute, role));
});

/**
 * Mobile: Case Room messages (newest first)
 * @route GET /api/v1/disputes/:id/messages
 */
export const getDisputeMessagesForParty = asyncHandler(async (req: AuthRequest, res) => {
    const { dispute } = await loadDisputeForParty(req);
    const result = await fetchDisputeMessages(dispute._id as mongoose.Types.ObjectId, {
        before: req.query.before as string | undefined,
        limit: Number(req.query.limit) || 50,
    });
    return successResponse(res, 200, "Messages fetched", result);
});

/**
 * Mobile: Send a message in the Case Room
 * @route POST /api/v1/disputes/:id/messages
 */
export const sendDisputeMessageAsParty = asyncHandler(async (req: AuthRequest, res) => {
    const { dispute, role, userId } = await loadDisputeForParty(req);
    if (isDisputeClosed(dispute.status)) {
        throw new BadRequestError("This complaint is closed. The chat is now read-only history.");
    }

    const validation = disputeMessageSchema.safeParse(req.body);
    if (!validation.success) {
        throw new BadRequestError(validation.error.issues[0]?.message || "Invalid message");
    }

    const message = await postDisputeMessage({
        dispute,
        senderType: role,
        senderId: userId,
        content: validation.data.content,
        attachments: validation.data.attachments,
        replyToId: validation.data.replyTo || null,
    });

    if (validation.data.attachments.length) {
        pushTimelineEvent(dispute, {
            type: 'evidence_added',
            actorType: role,
            actorName: message.senderName,
            note: `${validation.data.attachments.length} photo(s) shared`,
        });
        await Dispute.updateOne({ _id: dispute._id }, { $set: { timeline: dispute.timeline } });
    }

    return successResponse(res, 201, "Message sent", message);
});

/**
 * Mobile: Mark Case Room as read
 * @route POST /api/v1/disputes/:id/read
 */
export const markDisputeReadAsParty = asyncHandler(async (req: AuthRequest, res) => {
    const { dispute, role } = await loadDisputeForParty(req);
    await markDisputeRead(dispute._id as mongoose.Types.ObjectId, role);
    return successResponse(res, 200, "Marked as read");
});

/**
 * Mobile: Reporter withdraws the complaint after settling with the other side
 * @route POST /api/v1/disputes/:id/withdraw
 */
export const withdrawDispute = asyncHandler(async (req: AuthRequest, res) => {
    const { dispute, role, userId } = await loadDisputeForParty(req);
    if (dispute.raisedByType !== role) {
        throw new BadRequestError("Only the person who reported the issue can withdraw it");
    }
    if (isDisputeClosed(dispute.status)) {
        throw new BadRequestError("This complaint is already closed");
    }

    const validation = withdrawDisputeSchema.safeParse(req.body || {});
    const note = validation.success ? validation.data.note : '';
    const actorName = await resolvePartyName(role, userId);
    const now = new Date();

    dispute.status = 'withdrawn';
    dispute.outcome = 'settled';
    dispute.closedAt = now;
    dispute.closedByType = role;
    if (note) dispute.resolutionDetails = note;
    pushTimelineEvent(dispute, { type: 'withdrawn', actorType: role, actorName, note, at: now });
    await dispute.save();

    await postDisputeMessage({
        dispute,
        senderType: 'system',
        kind: 'system',
        content: `${actorName || (role === 'customer' ? 'Customer' : 'Ustad')} withdrew the complaint — issue settled by both sides.${note ? ` Note: "${note}"` : ''} This case is now closed.`,
        silent: true,
    });

    const bookingId = String(dispute.booking);
    const caseRef = String(dispute._id).slice(-6).toUpperCase();
    const otherId = role === 'customer' ? dispute.worker : dispute.customer;
    const otherType = role === 'customer' ? 'worker' : 'user';

    await Promise.allSettled([
        sendNotificationToRecipient(
            otherId,
            otherType,
            'Complaint closed — settled',
            `Complaint #${caseRef} was withdrawn. Normal payment for the job can continue.`,
            { type: 'dispute', bookingId, disputeId: String(dispute._id) },
            { type: 'dispute', icon: 'scale', color: '#34C759', bookingId, idempotencyKey: `dispute-withdrawn/${dispute._id}/${otherId}` },
        ),
        (async () => {
            const admins = await Admin.find({ isActive: { $ne: false } }).select('_id').limit(30);
            if (!admins.length) return;
            await Notification.insertMany(admins.map((admin) => ({
                recipient: admin._id,
                recipientType: 'admin',
                title: 'Complaint withdrawn',
                message: `Complaint #${caseRef} was withdrawn by the ${role === 'customer' ? 'customer' : 'Ustad'} (settled).`,
                type: 'dispute',
                icon: 'scale',
                color: '#34C759',
                isRead: false,
                idempotencyKey: `dispute-withdrawn-admin/${dispute._id}/${admin._id}`,
            })), { ordered: false }).catch((error: { code?: number }) => {
                if (error?.code !== 11000) throw error;
            });
        })(),
    ]);

    emitDisputeUpdated(dispute);
    return successResponse(res, 200, "Complaint withdrawn", await serializeDisputeForViewer(dispute, role));
});

/**
 * Admin: Dispute counters for dashboards / tabs
 * @route GET /api/v1/admin/disputes/stats
 */
export const getDisputeStats = asyncHandler(async (_req: AdminAuthRequest, res) => {
    const grouped = await Dispute.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    const byStatus: Record<string, number> = {};
    grouped.forEach((row: { _id: string; count: number }) => { byStatus[row._id] = row.count; });

    const open = byStatus.open || 0;
    const underReview = byStatus.under_review || 0;
    const resolved = byStatus.resolved || 0;
    const dismissed = byStatus.dismissed || 0;
    const withdrawn = byStatus.withdrawn || 0;

    // Active cases where a party wrote after the admin last read
    const awaitingAdminReply = await Dispute.countDocuments({
        status: { $in: ACTIVE_DISPUTE_STATUSES },
        lastMessageSenderType: { $in: ['customer', 'worker'] },
        $or: [
            { 'lastReadAt.admin': null },
            { $expr: { $gt: ['$lastMessageAt', '$lastReadAt.admin'] } },
        ],
    });

    return successResponse(res, 200, "Dispute stats", {
        total: open + underReview + resolved + dismissed + withdrawn,
        active: open + underReview,
        open,
        underReview,
        closed: resolved + dismissed + withdrawn,
        resolved,
        dismissed,
        withdrawn,
        awaitingAdminReply,
    });
});

/**
 * Admin: Get all disputes with query filters & pagination
 * @route GET /api/v1/admin/disputes
 */
export const getAllDisputes = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { status, reason, raisedByType, search, scope, page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 10, 100);
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};
    if (scope === 'active') query.status = { $in: ACTIVE_DISPUTE_STATUSES };
    if (scope === 'history') query.status = { $in: CLOSED_DISPUTE_STATUSES };
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

    const sort: Record<string, 1 | -1> = scope === 'history'
        ? { closedAt: -1, resolvedAt: -1, updatedAt: -1 }
        : { lastMessageAt: -1, createdAt: -1 };

    const total = await Dispute.countDocuments(query);
    const disputes = await Dispute.find(query)
        .populate('booking')
        .populate('customer', 'fullName phone profileImage')
        .populate('worker', 'fullName phone profileImage')
        .sort(sort)
        .skip(skip)
        .limit(limitNum) as IDispute[];

    const items = await Promise.all(disputes.map((dispute) => serializeDisputeForViewer(dispute, 'admin')));
    return paginatedResponse(res, 200, "Disputes fetched successfully", items, pageNum, limitNum, total);
});

/**
 * Admin: Get dispute details
 * @route GET /api/v1/admin/disputes/:id
 */
export const getDisputeDetails = asyncHandler(async (req: AdminAuthRequest, res) => {
    assertValidId(req.params.id);
    const dispute = await Dispute.findById(req.params.id)
        .populate('booking')
        .populate('customer', 'fullName phone email profileImage address city')
        .populate('worker', 'fullName phone email profileImage category hourlyRate city')
        .populate('resolvedBy', 'fullName email') as IDispute | null;

    if (!dispute) {
        throw new NotFoundError("Dispute not found");
    }

    return successResponse(res, 200, "Dispute details fetched successfully", await serializeDisputeForViewer(dispute, 'admin'));
});

/**
 * Admin: Case Room messages
 * @route GET /api/v1/admin/disputes/:id/messages
 */
export const getAdminDisputeMessages = asyncHandler(async (req: AdminAuthRequest, res) => {
    assertValidId(req.params.id);
    const exists = await Dispute.exists({ _id: req.params.id });
    if (!exists) throw new NotFoundError("Dispute not found");
    const result = await fetchDisputeMessages(req.params.id as string, {
        before: req.query.before as string | undefined,
        limit: Number(req.query.limit) || 100,
    });
    return successResponse(res, 200, "Messages fetched", result);
});

/**
 * Admin: Send a message as ApnaUstad Team
 * @route POST /api/v1/admin/disputes/:id/messages
 */
export const sendAdminDisputeMessage = asyncHandler(async (req: AdminAuthRequest, res) => {
    assertValidId(req.params.id);
    const dispute = await Dispute.findById(req.params.id) as IDispute | null;
    if (!dispute) throw new NotFoundError("Dispute not found");
    if (isDisputeClosed(dispute.status)) {
        throw new BadRequestError("This complaint is closed. The chat is read-only.");
    }

    const validation = disputeMessageSchema.safeParse(req.body);
    if (!validation.success) {
        throw new BadRequestError(validation.error.issues[0]?.message || "Invalid message");
    }

    const adminName = req.admin?.fullName ? `${req.admin.fullName} · ApnaUstad Team` : 'ApnaUstad Team';
    const message = await postDisputeMessage({
        dispute,
        senderType: 'admin',
        senderId: req.admin?._id ? String(req.admin._id) : null,
        senderName: adminName,
        content: validation.data.content,
        attachments: validation.data.attachments,
        replyToId: validation.data.replyTo || null,
    });

    // First admin reply automatically moves the case into "Team checking"
    if (dispute.status === 'open') {
        dispute.status = 'under_review';
        pushTimelineEvent(dispute, { type: 'under_review', actorType: 'admin', actorName: adminName, note: 'ApnaUstad Team joined the conversation' });
        await dispute.save();
        emitDisputeUpdated(dispute);
    }

    return successResponse(res, 201, "Message sent", message);
});

/**
 * Admin: Mark Case Room as read
 * @route POST /api/v1/admin/disputes/:id/read
 */
export const markAdminDisputeRead = asyncHandler(async (req: AdminAuthRequest, res) => {
    assertValidId(req.params.id);
    await markDisputeRead(req.params.id as string, 'admin');
    return successResponse(res, 200, "Marked as read");
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
        refundWorkerCommission = false,
        workerCommissionRefund = 0,
        moderation = {
            warnCustomer: false,
            warnWorker: false,
            workerPenalty: 0,
            refundWorkerCommission: false,
            workerCommissionRefund: 0,
            blockCustomer: false,
            blockWorker: false,
            blockReason: '',
        },
    } = validation.data;
    const adminId = req.admin?._id;
    const adminName = req.admin?.fullName ? `${req.admin.fullName} · ApnaUstad Team` : 'ApnaUstad Team';

    const session = await mongoose.startSession();
    let dispute: any = null;
    let walletOutcome = { workerCommissionRefund: 0, workerPenalty: 0, customerRefund: 0 };

    try {
        await session.withTransaction(async () => {
            dispute = await Dispute.findById(id).session(session);
            if (!dispute) {
                const error = new Error("Dispute not found");
                (error as any).statusCode = 404;
                throw error;
            }
            // Guard: never re-run wallet actions on an already-closed case
            if (isDisputeClosed(dispute.status)) {
                const error = new Error("This complaint is already closed and saved in history");
                (error as any).statusCode = 409;
                throw error;
            }

            const now = new Date();
            dispute.status = status;
            if (adminNotes !== undefined) dispute.adminNotes = adminNotes;
            if (resolutionDetails !== undefined) dispute.resolutionDetails = resolutionDetails;

            if (status === 'resolved' || status === 'dismissed') {
                dispute.resolvedBy = adminId ? new mongoose.Types.ObjectId(adminId) : undefined;
                dispute.resolvedAt = now;
                dispute.closedAt = now;
                dispute.closedByType = 'admin';
                dispute.outcome = status === 'resolved' ? 'customer_favor' : 'worker_favor';
                pushTimelineEvent(dispute, { type: status, actorType: 'admin', actorName: adminName, note: resolutionDetails || '', at: now });
            } else if (status === 'under_review') {
                pushTimelineEvent(dispute, { type: 'under_review', actorType: 'admin', actorName: adminName, note: adminNotes ? 'Team started checking' : '', at: now });
            }

            const booking = await Booking.findById(dispute.booking).session(session);
            if (booking) {
                const payment = await Payment.findOne({ booking: booking._id }).session(session);

                walletOutcome = await applyDisputeWalletActions({
                    dispute,
                    booking,
                    workerPenalty: moderation.workerPenalty || 0,
                    refundWorkerCommission: refundWorkerCommission || moderation.refundWorkerCommission,
                    workerCommissionRefund: workerCommissionRefund || moderation.workerCommissionRefund,
                    adminId: adminId ? new mongoose.Types.ObjectId(adminId) : undefined,
                    resolutionDetails,
                    session,
                });

                if (status === 'resolved') {
                    // Complaint upheld against worker -> cancel cash payment so no cash is due
                    if (payment) {
                        payment.status = 'cancelled';
                        payment.bookingStatusSnapshot = booking.status;
                        await payment.save({ session });
                    }

                    booking.paymentStatus = 'cancelled';
                    if (booking.status === 'ongoing' || booking.status === 'accepted') {
                        booking.status = 'cancelled';
                        booking.cancellationReason = `Resolved via complaint arbitration: ${resolutionDetails || 'Order cancelled'}`;
                        booking.cancelledAt = new Date();
                    }
                    await booking.save({ session });

                } else if (status === 'dismissed') {
                    // Ustad cleared -> payment marked paid or ongoing cash payment confirmed
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
        if (error?.statusCode === 404) throw new NotFoundError(error.message);
        throw new BadRequestError(error.message || "Failed to resolve dispute cleanly");
    } finally {
        await session.endSession();
    }

    let moderationApplied = null;
    if (dispute) {
        try {
            const bIdStr = dispute.booking.toString().slice(-6).toUpperCase();
            const bookingId = dispute.booking.toString();
            const disputeId = dispute._id.toString();
            const disputeNotifyOptions = {
                type: 'dispute' as const,
                icon: 'scale',
                color: '#FF3B30',
                bookingId,
            };
            const notifyData = { type: 'dispute', bookingId, disputeId };

            if (status === 'under_review') {
                await recordAdminAction(req, {
                    action: 'dispute.under_review',
                    entityType: 'dispute',
                    entityId: disputeId,
                    reason: adminNotes || 'Marked under investigation',
                    metadata: { booking: bookingId },
                });
                await postDisputeMessage({
                    dispute,
                    senderType: 'system',
                    kind: 'system',
                    content: 'ApnaUstad Team is now checking this complaint. Please share any details or photos here.',
                    silent: true,
                });
                await sendNotificationToRecipient(
                    dispute.customer,
                    'user',
                    'Checking your complaint',
                    `Our team is checking your report for booking #${bIdStr}.`,
                    notifyData,
                    disputeNotifyOptions,
                );
                await sendNotificationToRecipient(
                    dispute.worker,
                    'worker',
                    'Complaint being checked',
                    `Our team is checking a report on booking #${bIdStr}.`,
                    notifyData,
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

                moderationApplied.workerCommissionRefund = walletOutcome.workerCommissionRefund;
                moderationApplied.workerPenalty = walletOutcome.workerPenalty;
                moderationApplied.customerRefund = 0;

                dispute.moderationApplied = moderationApplied;
                await dispute.save();

                const modSummary = buildModerationSummary(moderationApplied);

                await recordAdminAction(req, {
                    action: `dispute.${status}`,
                    entityType: 'dispute',
                    entityId: disputeId,
                    reason: adminNotes || `Dispute ${status} by Admin`,
                    metadata: {
                        booking: bookingId,
                        customer: dispute.customer?.toString(),
                        worker: dispute.worker?.toString(),
                        workerCommissionRefund: walletOutcome.workerCommissionRefund,
                        workerPenalty: walletOutcome.workerPenalty,
                        moderation: moderationApplied,
                        summary: modSummary,
                    },
                });

                // Final decision is posted in the Case Room so it lives in the history
                const decisionHeadline = status === 'resolved'
                    ? `Decision: Customer complaint upheld. Cash payment agreement cancelled.${walletOutcome.workerCommissionRefund > 0 ? ` Rs. ${walletOutcome.workerCommissionRefund.toLocaleString()} commission refunded to Ustad wallet.` : ''}`
                    : `Decision: Ustad cleared. Cash payment for the job continues.${walletOutcome.workerCommissionRefund > 0 ? ` Rs. ${walletOutcome.workerCommissionRefund.toLocaleString()} commission refunded to Ustad wallet.` : ''}`;
                await postDisputeMessage({
                    dispute,
                    senderType: 'admin',
                    senderId: adminId ? String(adminId) : null,
                    senderName: adminName,
                    kind: 'decision',
                    content: `${decisionHeadline}${resolutionDetails ? `\n\n${resolutionDetails}` : ''}\n\nThis case is now closed.`,
                    silent: true,
                });

                if (status === 'resolved') {
                    await sendNotificationToRecipient(
                        dispute.customer,
                        'user',
                        'Complaint resolved',
                        `Your report for booking #${bIdStr} was resolved. Cash payment agreement was cancelled. ${resolutionDetails || ''}`.trim(),
                        notifyData,
                        { ...disputeNotifyOptions, color: '#34C759' },
                    );
                    const workerRefundMsg = walletOutcome.workerCommissionRefund > 0
                        ? ` Rs. ${walletOutcome.workerCommissionRefund.toLocaleString()} commission was refunded to your wallet.`
                        : '';
                    const workerPenaltyMsg = walletOutcome.workerPenalty > 0
                        ? ` Rs. ${walletOutcome.workerPenalty.toLocaleString()} penalty was deducted from your wallet.`
                        : '';
                    await sendNotificationToRecipient(
                        dispute.worker,
                        'worker',
                        'Complaint decision on booking',
                        `Complaint review finished on booking #${bIdStr}.${workerRefundMsg}${workerPenaltyMsg} ${modSummary !== 'no extra actions' ? `Details: ${modSummary}.` : ''}`.trim(),
                        notifyData,
                        disputeNotifyOptions,
                    );
                } else {
                    await sendNotificationToRecipient(
                        dispute.customer,
                        'user',
                        'Complaint closed',
                        `Our team checked your report for booking #${bIdStr} and closed it. ${resolutionDetails || ''}`.trim(),
                        notifyData,
                        disputeNotifyOptions,
                    );
                    const workerRefundMsg = walletOutcome.workerCommissionRefund > 0
                        ? ` Rs. ${walletOutcome.workerCommissionRefund.toLocaleString()} commission was refunded to your wallet.`
                        : '';
                    await sendNotificationToRecipient(
                        dispute.worker,
                        'worker',
                        'Complaint closed — All clear',
                        `Good news! The report on booking #${bIdStr} was closed in your favour.${workerRefundMsg} Normal cash payment can continue.`,
                        notifyData,
                        { ...disputeNotifyOptions, color: '#34C759' },
                    );
                }
            }
        } catch (notifErr: any) {
            logger.error("Failed to execute post-resolve dispute actions:", notifErr);
        }
        emitDisputeUpdated(dispute);
    }

    return successResponse(res, 200, `Dispute updated to ${status} successfully`, dispute);
});
