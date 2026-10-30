import mongoose from 'mongoose';
import CommissionReservation from '../models/CommissionReservation';
import WalletTransaction from '../models/WalletTransaction';
import WorkerWallet from '../models/WorkerWallet';
import { getOrCreateWallet } from './workerWalletService';

type ReservationOptions = {
    session?: mongoose.ClientSession;
};

type ReserveCommissionInput = {
    workerId: string | mongoose.Types.ObjectId;
    bookingId: string | mongoose.Types.ObjectId;
    jobPostId?: string | mongoose.Types.ObjectId;
    bidId?: string | mongoose.Types.ObjectId;
    amount: number;
    commissionRateSnapshot: number;
};

const toObjectId = (value: string | mongoose.Types.ObjectId) => (
    typeof value === 'string' ? new mongoose.Types.ObjectId(value) : value
);

/**
 * Deducts platform commission immediately from worker wallet upon job assignment.
 */
export const reserveCommission = async (
    input: ReserveCommissionInput,
    options: ReservationOptions = {}
) => {
    const { session } = options;
    const amount = Number(input.amount || 0);
    if (amount <= 0) return null;

    const existing = await CommissionReservation.findOne({ booking: input.bookingId }).session(session ?? null);
    if (existing) {
        existing.$locals.createdByReserveCall = false;
        return existing;
    }

    const wallet = await getOrCreateWallet(input.workerId, session);
    const bookingRef = String(input.bookingId).slice(-6).toUpperCase();

    // Check if worker has sufficient balance to pay commission upfront
    const balanceBefore = Number(wallet.balance || 0);
    if (balanceBefore < amount) {
        const error = new Error(`Insufficient wallet balance to accept this job. Commission of Rs. ${Math.round(amount)} is deducted upon assignment.`);
        (error as any).statusCode = 402;
        (error as any).requiredBalance = amount;
        (error as any).currentBalance = balanceBefore;
        throw error;
    }

    // Cut commission directly from worker wallet balance
    const updatedWallet = await WorkerWallet.findOneAndUpdate(
        {
            _id: wallet._id,
            isActive: true,
            balance: { $gte: amount }
        },
        {
            $inc: {
                balance: -amount,
                totalCommissionDeducted: amount
            }
        },
        { new: true, ...(session ? { session } : {}) }
    );

    if (!updatedWallet) {
        const error = new Error(`Insufficient wallet balance to accept this job. Commission of Rs. ${Math.round(amount)} is deducted upon assignment.`);
        (error as any).statusCode = 402;
        throw error;
    }

    // Record commission deduction ledger transaction
    await WalletTransaction.create([{
        wallet: updatedWallet._id,
        worker: toObjectId(input.workerId),
        type: 'commission_deduction',
        amount,
        balanceBefore,
        balanceAfter: balanceBefore - amount,
        description: `Commission for job #${bookingRef} (deducted upon assignment)`,
        reference: {
            booking: toObjectId(input.bookingId),
            ...(input.jobPostId ? { jobPost: toObjectId(input.jobPostId) } : {}),
        },
        performedBy: {
            actor: toObjectId(input.workerId),
            actorType: 'worker'
        }
    }], session ? { session } : {});

    try {
        const [reservation] = await CommissionReservation.create([{
            worker: toObjectId(input.workerId),
            wallet: updatedWallet._id,
            booking: toObjectId(input.bookingId),
            ...(input.jobPostId ? { jobPost: toObjectId(input.jobPostId) } : {}),
            ...(input.bidId ? { bid: toObjectId(input.bidId) } : {}),
            amount,
            commissionRateSnapshot: Number(input.commissionRateSnapshot || 0),
            status: 'settled',
            settledAt: new Date()
        }], session ? { session } : {});

        if (reservation) reservation.$locals.createdByReserveCall = true;
        return reservation || null;
    } catch (error: any) {
        if (!session) {
            // Revert deduction on race condition error
            await WorkerWallet.updateOne(
                { _id: updatedWallet._id },
                { $inc: { balance: amount, totalCommissionDeducted: -amount } }
            );
        }
        if (error?.code === 11000 && !session) {
            const concurrentReservation = await CommissionReservation.findOne({ booking: input.bookingId }).session(session ?? null);
            if (concurrentReservation) concurrentReservation.$locals.createdByReserveCall = false;
            return concurrentReservation;
        }
        throw error;
    }
};

/**
 * Refunds commission back to worker if booking is cancelled before completion.
 */
export const releaseCommissionReservation = async (
    bookingId: string | mongoose.Types.ObjectId,
    options: ReservationOptions = {}
) => {
    const { session } = options;
    const reservation = await CommissionReservation.findOne({ booking: bookingId }).session(session ?? null);
    if (!reservation) return null;

    if (reservation.status === 'released') {
        return reservation;
    }

    const bookingRef = String(bookingId).slice(-6).toUpperCase();
    const amount = Number(reservation.amount || 0);

    // If commission was cut upon assignment, refund it back to worker wallet
    if (amount > 0) {
        const wallet = await WorkerWallet.findById(reservation.wallet).session(session ?? null);
        if (wallet) {
            const balanceBefore = Number(wallet.balance || 0);
            const balanceAfter = balanceBefore + amount;

            await WorkerWallet.updateOne(
                { _id: wallet._id },
                {
                    $inc: {
                        balance: amount,
                        totalCommissionDeducted: -Math.min(wallet.totalCommissionDeducted, amount)
                    }
                },
                session ? { session } : {}
            );

            await WalletTransaction.create([{
                wallet: wallet._id,
                worker: reservation.worker,
                type: 'refund',
                amount,
                balanceBefore,
                balanceAfter,
                description: `Commission refund for cancelled job #${bookingRef}`,
                reference: {
                    booking: toObjectId(bookingId),
                },
                performedBy: {
                    actor: reservation.worker,
                    actorType: 'system'
                }
            }], session ? { session } : {});
        }
    }

    reservation.status = 'released';
    reservation.releasedAt = new Date();
    await reservation.save(session ? { session } : {});
    return reservation;
};

/**
 * Finalizes commission ledger on job completion.
 * If commission was already deducted upon assignment, it avoids double-deduction.
 */
export const settleCommissionReservation = async (
    workerId: string | mongoose.Types.ObjectId,
    bookingId: string | mongoose.Types.ObjectId,
    paymentId: string | mongoose.Types.ObjectId,
    fallbackAmount: number,
    options: ReservationOptions = {}
) => {
    const { session } = options;

    // Check if commission was already deducted for this booking
    const existingTransaction = await WalletTransaction.findOne({
        type: 'commission_deduction',
        $or: [
            { 'reference.booking': toObjectId(bookingId) },
            { 'reference.payment': toObjectId(paymentId) }
        ]
    }).session(session ?? null);

    if (existingTransaction) {
        // Already deducted upon assignment - just make sure payment reference is linked
        if (!existingTransaction.reference?.payment) {
            existingTransaction.reference = {
                ...existingTransaction.reference,
                payment: toObjectId(paymentId)
            };
            await existingTransaction.save(session ? { session } : {});
        }
        return existingTransaction;
    }

    // Fallback for legacy bookings where commission was not cut on assignment
    const reservation = await CommissionReservation.findOne({ booking: bookingId }).session(session ?? null);
    const amount = Number(reservation?.amount ?? fallbackAmount ?? 0);
    if (amount <= 0) return null;

    const wallet = await getOrCreateWallet(workerId, session);
    const balanceBefore = Number(wallet.balance || 0);
    const balanceAfter = balanceBefore - amount;
    const reservedRelease = reservation?.status === 'held' ? amount : 0;

    await WorkerWallet.updateOne(
        { _id: wallet._id },
        {
            $inc: {
                balance: -amount,
                totalCommissionDeducted: amount,
                ...(reservedRelease > 0 ? { reservedBalance: -reservedRelease } : {})
            }
        },
        session ? { session } : {}
    );

    const [transaction] = await WalletTransaction.create([{
        wallet: wallet._id,
        worker: toObjectId(workerId),
        type: 'commission_deduction',
        amount,
        balanceBefore,
        balanceAfter,
        description: `App fee for job #${String(bookingId).slice(-6).toUpperCase()}`,
        reference: {
            booking: toObjectId(bookingId),
            payment: toObjectId(paymentId)
        },
        performedBy: {
            actor: toObjectId(workerId),
            actorType: 'worker'
        }
    }], session ? { session } : {});

    if (reservation?.status === 'held') {
        reservation.status = 'settled';
        reservation.settledAt = new Date();
        await reservation.save(session ? { session } : {});
    }

    return transaction || null;
};

/**
 * Dispute & Admin refund helper: refunds commission directly to worker wallet
 */
export const refundCommissionToWorker = async ({
    workerId,
    bookingId,
    amount,
    adminId,
    reason,
    session
}: {
    workerId: string | mongoose.Types.ObjectId;
    bookingId: string | mongoose.Types.ObjectId;
    amount: number;
    adminId?: string | mongoose.Types.ObjectId | undefined;
    reason?: string | undefined;
    session?: mongoose.ClientSession | undefined;
}) => {
    if (amount <= 0) return null;
    const wallet = await getOrCreateWallet(workerId, session);
    const bookingRef = String(bookingId).slice(-6).toUpperCase();
    const balanceBefore = Number(wallet.balance || 0);
    const balanceAfter = balanceBefore + amount;

    await WorkerWallet.updateOne(
        { _id: wallet._id },
        {
            $inc: {
                balance: amount,
                totalCommissionDeducted: -Math.min(wallet.totalCommissionDeducted, amount)
            }
        },
        session ? { session } : {}
    );

    const [tx] = await WalletTransaction.create([{
        wallet: wallet._id,
        worker: toObjectId(workerId),
        type: 'refund',
        amount,
        balanceBefore,
        balanceAfter,
        description: `Commission refund for disputed job #${bookingRef}${reason ? `: ${reason}` : ''}`,
        reference: {
            booking: toObjectId(bookingId)
        },
        performedBy: {
            actor: adminId ? toObjectId(adminId) : toObjectId(workerId),
            actorType: adminId ? 'admin' : 'system'
        }
    }], session ? { session } : {});

    return tx;
};
