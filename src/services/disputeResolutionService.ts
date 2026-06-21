import mongoose from 'mongoose';
import User from '../models/User';
import Worker from '../models/Workers';
import WorkerWallet from '../models/WorkerWallet';
import WalletTransaction from '../models/WalletTransaction';
import { type IDispute } from '../models/Dispute';
import { creditUserWallet } from './userWalletService';
import { sendNotificationToRecipient } from './notificationHelper';
import { recordAdminAction } from './adminAuditLog';
import { type AdminAuthRequest } from '../middlewares/admin.middleware';

export type DisputeModerationInput = {
    warnCustomer?: boolean;
    warnWorker?: boolean;
    workerPenalty?: number;
    blockCustomer?: boolean;
    blockWorker?: boolean;
    blockReason?: string;
};

export type DisputeModerationApplied = {
    warnedCustomer: boolean;
    warnedWorker: boolean;
    workerPenalty: number;
    customerRefund: number;
    customerBlocked: boolean;
    workerBlocked: boolean;
};

const deductWorkerWallet = async (
    workerId: mongoose.Types.ObjectId,
    amount: number,
    adminId: mongoose.Types.ObjectId | undefined,
    description: string,
    bookingId: mongoose.Types.ObjectId,
    disputeId: mongoose.Types.ObjectId,
    session: mongoose.ClientSession,
) => {
    if (amount <= 0) return;

    const workerWallet = await WorkerWallet.findOneAndUpdate(
        { worker: workerId },
        { $inc: { balance: -amount, totalCommissionDeducted: amount } },
        { new: true, session },
    );

    if (!workerWallet) return;

    const actorId = adminId || new mongoose.Types.ObjectId();
    await WalletTransaction.create([{
        wallet: workerWallet._id,
        worker: workerId,
        type: 'adjustment',
        amount,
        balanceBefore: workerWallet.balance + amount,
        balanceAfter: workerWallet.balance,
        description,
        performedBy: { actor: actorId, actorType: 'admin' },
        reference: { booking: bookingId },
    }], { session });
};

export const applyDisputeWalletActions = async ({
    dispute,
    booking,
    refundAmount,
    workerPenalty,
    adminId,
    resolutionDetails,
    session,
}: {
    dispute: IDispute;
    booking: any;
    refundAmount: number;
    workerPenalty: number;
    adminId?: mongoose.Types.ObjectId | undefined;
    resolutionDetails?: string;
    session: mongoose.ClientSession;
}) => {
    const jobCap = Number(dispute.amountDisputed || 0);
    const normalizedRefund = Math.min(Math.max(0, refundAmount), jobCap);
    const normalizedPenalty = Math.max(0, workerPenalty);
    const totalWorkerDebit = normalizedRefund + normalizedPenalty;

    if (totalWorkerDebit > 0) {
        await deductWorkerWallet(
            dispute.worker,
            totalWorkerDebit,
            adminId,
            `Complaint moderation deduction (Dispute ${dispute._id}): ${resolutionDetails || 'Admin decision'}`,
            booking._id,
            dispute._id as mongoose.Types.ObjectId,
            session,
        );
    }

    if (normalizedRefund > 0) {
        const actorId = adminId || new mongoose.Types.ObjectId();
        await creditUserWallet(
            dispute.customer,
            normalizedRefund,
            { actor: actorId, actorType: 'admin' },
            `Complaint refund credit (Dispute ${dispute._id}): ${resolutionDetails || 'Credited by admin'}`,
            { booking: booking._id, dispute: dispute._id },
            session,
        );
    }

    return { customerRefund: normalizedRefund, workerPenalty: normalizedPenalty };
};

export const applyDisputeModerationAfterResolve = async ({
    req,
    dispute,
    moderation,
    resolutionDetails,
    bookingRef,
    bookingId,
}: {
    req: AdminAuthRequest;
    dispute: IDispute;
    moderation: DisputeModerationInput;
    resolutionDetails: string;
    bookingRef: string;
    bookingId: string;
}) => {
    const applied: DisputeModerationApplied = {
        warnedCustomer: false,
        warnedWorker: false,
        workerPenalty: Number(moderation.workerPenalty || 0),
        customerRefund: 0,
        customerBlocked: false,
        workerBlocked: false,
    };

    const adminId = req.admin?._id;
    const warnMessage = resolutionDetails || 'Please follow ApnaUstad community guidelines on future bookings.';

    if (moderation.warnCustomer) {
        await sendNotificationToRecipient(
            dispute.customer,
            'user',
            'Official warning — ApnaUstad',
            `Warning regarding complaint on booking #${bookingRef}. ${warnMessage}`,
            { type: 'general', bookingId },
            { type: 'general', icon: 'alert', color: '#FF9F0A', bookingId, idempotencyKey: `dispute-warn-customer/${dispute._id}` },
        );
        applied.warnedCustomer = true;
    }

    if (moderation.warnWorker) {
        await sendNotificationToRecipient(
            dispute.worker,
            'worker',
            'Official warning — ApnaUstad',
            `Warning regarding complaint on booking #${bookingRef}. ${warnMessage}`,
            { type: 'general', bookingId },
            { type: 'general', icon: 'alert', color: '#FF9F0A', bookingId, idempotencyKey: `dispute-warn-worker/${dispute._id}` },
        );
        applied.warnedWorker = true;
    }

    if (moderation.blockCustomer) {
        const reason = moderation.blockReason || `Blocked after complaint review #${bookingRef}`;
        const user = await User.findByIdAndUpdate(
            dispute.customer,
            {
                isActive: false,
                deactivationReason: reason,
                deactivatedAt: new Date(),
                deactivatedBy: adminId || null,
            },
            { new: true },
        );
        if (user) {
            applied.customerBlocked = true;
            await recordAdminAction(req, {
                action: 'user.deactivate',
                entityType: 'user',
                entityId: user._id.toString(),
                reason,
                metadata: { source: 'dispute_moderation', disputeId: String(dispute._id) },
            });
            await sendNotificationToRecipient(
                dispute.customer,
                'user',
                'Account suspended',
                `Your ApnaUstad account was suspended after a complaint review. Reason: ${reason}`,
                { type: 'general' },
            );
        }
    }

    if (moderation.blockWorker) {
        const reason = moderation.blockReason || `Blocked after complaint review #${bookingRef}`;
        const worker = await Worker.findByIdAndUpdate(
            dispute.worker,
            {
                isActive: false,
                isAvailable: false,
                isInstantAvailable: false,
                isScheduledAvailable: false,
                deactivationReason: reason,
                deactivatedAt: new Date(),
                deactivatedBy: adminId || null,
            },
            { new: true },
        );
        if (worker) {
            applied.workerBlocked = true;
            await recordAdminAction(req, {
                action: 'worker.deactivate',
                entityType: 'worker',
                entityId: worker._id.toString(),
                reason,
                metadata: { source: 'dispute_moderation', disputeId: String(dispute._id) },
            });
            await sendNotificationToRecipient(
                dispute.worker,
                'worker',
                'Ustad account suspended',
                `Your ApnaUstad Ustad account was suspended after a complaint review. Reason: ${reason}`,
                { type: 'general' },
            );
        }
    }

    return applied;
};

export const buildModerationSummary = (applied: DisputeModerationApplied) => {
    const parts: string[] = [];
    if (applied.warnedCustomer) parts.push('customer warned');
    if (applied.warnedWorker) parts.push('Ustad warned');
    if (applied.customerRefund > 0) parts.push(`Rs. ${applied.customerRefund.toLocaleString()} refunded`);
    if (applied.workerPenalty > 0) parts.push(`Rs. ${applied.workerPenalty.toLocaleString()} Ustad penalty`);
    if (applied.customerBlocked) parts.push('customer blocked');
    if (applied.workerBlocked) parts.push('Ustad blocked');
    return parts.join(', ') || 'no extra actions';
};
