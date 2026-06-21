import mongoose from 'mongoose';
import Admin from '../models/Admin';
import Dispute, { type IDispute } from '../models/Dispute';
import Notification from '../models/Notifications';
import { sendNotificationToRecipient } from './notificationHelper';
import logger from '../config/logger';

export const DISPUTE_WINDOW_DAYS = 14;
export const ACTIVE_DISPUTE_STATUSES = ['open', 'under_review'] as const;
export const DISPUTE_ELIGIBLE_BOOKING_STATUSES = ['accepted', 'ongoing', 'completed', 'cancelled'] as const;

/** Cash/job value tied to the booking — used for admin refunds, not entered by users. */
export const getBookingJobAmount = (booking: any) => (
    Number(booking?.agreement?.cashDue ?? booking?.totalAmount ?? booking?.hourlyRate ?? 0)
);

export const DISPUTE_REASON_LABELS: Record<IDispute['reason'], string> = {
    incomplete_work: 'Work not completed',
    unfair_pricing: 'Overcharged / unfair price',
    no_show: 'Ustad did not show up',
    poor_quality: 'Poor workmanship',
    payment_issue: 'Cash payment issue',
    other: 'Other problem',
};

export const getDisputeStatusLabel = (status: IDispute['status'] | null) => {
    switch (status) {
        case 'open': return 'Report received';
        case 'under_review': return 'Under investigation';
        case 'resolved': return 'Resolved in customer favour';
        case 'dismissed': return 'Closed — Ustad cleared';
        default: return '';
    }
};

const getDisputeNextStep = (status: IDispute['status'] | null) => {
    switch (status) {
        case 'open':
            return 'ApnaUstad team will review your report and may contact both parties.';
        case 'under_review':
            return 'Our moderators are checking details. Cash payment stays on hold until a decision.';
        case 'resolved':
            return 'Decision is final. Check notifications for wallet or payment updates.';
        case 'dismissed':
            return 'Complaint was not upheld. Normal booking payment can continue.';
        default:
            return '';
    }
};

export type BookingDisputeMeta = {
    hasDispute: boolean;
    disputeId: string | null;
    disputeStatus: IDispute['status'] | null;
    canRaiseDispute: boolean;
    canRaiseDisputeReason?: string;
    /** Job cash value (PKR) — auto from booking, not user-entered */
    bookingAmount?: number;
    amountDisputed?: number;
    raisedByType?: 'customer' | 'worker';
    statusLabel?: string;
    nextStep?: string;
};

export const getActiveDisputeForBooking = async (bookingId: string | mongoose.Types.ObjectId) => (
    Dispute.findOne({ booking: bookingId })
);

export const assertNoActiveDisputeForBooking = async (bookingId: string | mongoose.Types.ObjectId) => {
    const dispute = await getActiveDisputeForBooking(bookingId);
    if (!dispute) return null;
    if (ACTIVE_DISPUTE_STATUSES.includes(dispute.status as typeof ACTIVE_DISPUTE_STATUSES[number])) {
        const error = new Error('This booking has an open complaint. Cash payment is paused until ApnaUstad completes review.');
        (error as any).statusCode = 409;
        throw error;
    }
    return dispute;
};

const getDisputeWindowStart = (booking: any) => {
    if (booking.status === 'completed' && booking.completedAt) {
        return new Date(booking.completedAt);
    }
    if (booking.status === 'cancelled') {
        return new Date(booking.updatedAt || booking.createdAt);
    }
    return null;
};

export const evaluateDisputeEligibility = async ({
    booking,
    userId,
    userType,
}: {
    booking: any;
    userId: string;
    userType?: string | undefined;
}): Promise<BookingDisputeMeta> => {
    const bookingAmount = getBookingJobAmount(booking);
    const existing = await Dispute.findOne({ booking: booking._id }).lean();

    if (existing) {
        return {
            hasDispute: true,
            disputeId: String(existing._id),
            disputeStatus: existing.status,
            canRaiseDispute: false,
            canRaiseDisputeReason: 'A complaint is already open on this booking.',
            bookingAmount,
            amountDisputed: existing.amountDisputed,
            raisedByType: existing.raisedByType,
            statusLabel: getDisputeStatusLabel(existing.status),
            nextStep: getDisputeNextStep(existing.status),
        };
    }

    const isCustomer = booking.customer?.toString?.() === userId || booking.customer?._id?.toString?.() === userId;
    const isWorker = booking.worker?.toString?.() === userId || booking.worker?._id?.toString?.() === userId;

    if (!isCustomer && !isWorker && userType !== 'admin') {
        return {
            hasDispute: false,
            disputeId: null,
            disputeStatus: null,
            canRaiseDispute: false,
            canRaiseDisputeReason: 'Only the customer or assigned Ustad can report an issue on this booking.',
        };
    }

    if (!DISPUTE_ELIGIBLE_BOOKING_STATUSES.includes(booking.status)) {
        return {
            hasDispute: false,
            disputeId: null,
            disputeStatus: null,
            canRaiseDispute: false,
            canRaiseDisputeReason: 'You can report a problem after an Ustad is assigned to this job.',
            bookingAmount,
        };
    }

    if (booking.status === 'completed' || booking.status === 'cancelled') {
        return {
            hasDispute: false,
            disputeId: null,
            disputeStatus: null,
            canRaiseDispute: false,
            canRaiseDisputeReason: 'For issues after job completion, please use Help Center in your profile.',
            bookingAmount,
        };
    }

    const windowStart = getDisputeWindowStart(booking);
    if (windowStart) {
        const deadline = new Date(windowStart);
        deadline.setDate(deadline.getDate() + DISPUTE_WINDOW_DAYS);
        if (new Date() > deadline) {
            return {
                hasDispute: false,
                disputeId: null,
                disputeStatus: null,
                canRaiseDispute: false,
                canRaiseDisputeReason: `Reporting window closed (${DISPUTE_WINDOW_DAYS} days after job ended). Please use Help Center for older issues.`,
            };
        }
    }

    return {
        hasDispute: false,
        disputeId: null,
        disputeStatus: null,
        canRaiseDispute: true,
        bookingAmount,
    };
};

export const notifyPartiesAboutNewDispute = async (dispute: IDispute, booking: any) => {
    const bookingId = String(booking._id);
    const bookingRef = bookingId.slice(-6).toUpperCase();
    const raisedByLabel = dispute.raisedByType === 'customer' ? 'customer' : 'Ustad';
    const otherPartyId = dispute.raisedByType === 'customer' ? dispute.worker : dispute.customer;
    const otherPartyType = dispute.raisedByType === 'customer' ? 'worker' : 'user';
    const disputeOptions = {
        type: 'dispute' as const,
        icon: 'scale',
        color: '#FF3B30',
        bookingId,
    };

    await Promise.allSettled([
        sendNotificationToRecipient(
            otherPartyId,
            otherPartyType as 'user' | 'worker',
            'Complaint received',
            `The ${raisedByLabel} reported an issue on booking #${bookingRef}. ApnaUstad will review it fairly.`,
            { type: 'dispute', bookingId },
            { ...disputeOptions, idempotencyKey: `dispute-open/${dispute._id}/${otherPartyId}` },
        ),
        sendNotificationToRecipient(
            dispute.raisedBy,
            dispute.raisedByType === 'customer' ? 'user' : 'worker',
            'Complaint submitted',
            `We received your report for booking #${bookingRef}. Our team will review and update you soon.`,
            { type: 'dispute', bookingId },
            { ...disputeOptions, idempotencyKey: `dispute-submitted/${dispute._id}/${dispute.raisedBy}` },
        ),
    ]);
};

export const notifyAdminsAboutDispute = async (dispute: IDispute, booking: any) => {
    try {
        const admins = await Admin.find({ isActive: { $ne: false } }).select('_id').limit(30);
        if (!admins.length) return;

        const bookingRef = String(booking._id).slice(-6).toUpperCase();
        const category = booking.category || 'Service';
        const reasonLabel = DISPUTE_REASON_LABELS[dispute.reason as IDispute['reason']] || dispute.reason;
        const message = `${dispute.raisedByType === 'customer' ? 'Customer' : 'Ustad'} reported "${reasonLabel}" on ${category} booking #${bookingRef}.`;

        await Notification.insertMany(admins.map((admin) => ({
            recipient: admin._id,
            recipientType: 'admin',
            title: 'New booking dispute',
            message,
            type: 'dispute',
            icon: 'scale',
            color: '#FF3B30',
            isRead: false,
            idempotencyKey: `dispute-admin/${dispute._id}/${admin._id}`,
        })), { ordered: false }).catch((error: { code?: number }) => {
            if (error?.code !== 11000) throw error;
        });
    } catch (error: any) {
        logger.error('Failed to notify admins about dispute:', error);
    }
};
