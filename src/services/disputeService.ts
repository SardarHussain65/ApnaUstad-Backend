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
    incomplete_work: 'Work not finished',
    unfair_pricing: 'Asked for extra money',
    no_show: 'Ustad did not arrive',
    poor_quality: 'Work not done properly',
    payment_issue: 'Cash payment issue',
    other: 'Other issue',
};

export const getDisputeStatusLabel = (status: IDispute['status'] | null) => {
    switch (status) {
        case 'open': return 'Report received';
        case 'under_review': return 'Being checked';
        case 'resolved': return 'Closed — Customer favoured';
        case 'dismissed': return 'Closed — Ustad cleared';
        case 'withdrawn': return 'Closed — Settled by both sides';
        default: return '';
    }
};

export const getDisputeNextStep = (status: IDispute['status'] | null) => {
    switch (status) {
        case 'open':
            return 'Open the complaint chat to talk with the other side and ApnaUstad Team.';
        case 'under_review':
            return 'Our team is checking the details. Cash payment stays paused until we finish checking.';
        case 'resolved':
            return 'This issue is closed. Check your notifications or wallet for any balance updates.';
        case 'dismissed':
            return 'Complaint closed. Normal cash payment for the job can continue.';
        case 'withdrawn':
            return 'Complaint withdrawn after both sides agreed. Normal cash payment can continue.';
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

export const buildDisputeMeta = (
    booking: any,
    dispute: any,
    userId: string,
    userType?: string
): BookingDisputeMeta => {
    const bookingAmount = getBookingJobAmount(booking);

    if (dispute) {
        return {
            hasDispute: true,
            disputeId: String(dispute._id),
            disputeStatus: dispute.status,
            canRaiseDispute: false,
            canRaiseDisputeReason: (ACTIVE_DISPUTE_STATUSES as readonly string[]).includes(dispute.status)
                ? 'A complaint is already open on this booking.'
                : 'A complaint for this booking was already closed. Check it in My Complaints → History.',
            bookingAmount,
            amountDisputed: dispute.amountDisputed,
            raisedByType: dispute.raisedByType,
            statusLabel: getDisputeStatusLabel(dispute.status),
            nextStep: getDisputeNextStep(dispute.status),
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

export const evaluateDisputeEligibility = async ({
    booking,
    userId,
    userType,
}: {
    booking: any;
    userId: string;
    userType?: string | undefined;
}): Promise<BookingDisputeMeta> => {
    const existing = await Dispute.findOne({ booking: booking._id }).lean();
    return buildDisputeMeta(booking, existing, userId, userType);
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
