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
    const updatedWallet = await WorkerWallet.findOneAndUpdate(
        {
            _id: wallet._id,
            isActive: true,
            $expr: {
                $gte: [
                    { $subtract: ['$balance', { $ifNull: ['$reservedBalance', 0] }] },
                    amount
                ]
            }
        },
        { $inc: { reservedBalance: amount } },
        { new: true, ...(session ? { session } : {}) }
    );

    if (!updatedWallet) {
        const error = new Error('Wallet balance is no longer sufficient to reserve the platform commission.');
        (error as any).statusCode = 402;
        throw error;
    }

    try {
        const [reservation] = await CommissionReservation.create([{
            worker: toObjectId(input.workerId),
            wallet: updatedWallet._id,
            booking: toObjectId(input.bookingId),
            ...(input.jobPostId ? { jobPost: toObjectId(input.jobPostId) } : {}),
            ...(input.bidId ? { bid: toObjectId(input.bidId) } : {}),
            amount,
            commissionRateSnapshot: Number(input.commissionRateSnapshot || 0),
            status: 'held'
        }], session ? { session } : {});

        if (reservation) reservation.$locals.createdByReserveCall = true;
        return reservation || null;
    } catch (error: any) {
        if (!session) {
            await WorkerWallet.updateOne(
                { _id: updatedWallet._id },
                { $inc: { reservedBalance: -amount } }
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

export const releaseCommissionReservation = async (
    bookingId: string | mongoose.Types.ObjectId,
    options: ReservationOptions = {}
) => {
    const { session } = options;
    const reservation = await CommissionReservation.findOneAndUpdate(
        { booking: bookingId, status: 'held' },
        { $set: { status: 'released', releasedAt: new Date() } },
        { new: true, ...(session ? { session } : {}) }
    );
    if (!reservation) {
        return CommissionReservation.findOne({ booking: bookingId }).session(session ?? null);
    }

    await WorkerWallet.updateOne(
        { _id: reservation.wallet },
        { $inc: { reservedBalance: -reservation.amount } },
        session ? { session } : {}
    );
    return reservation;
};

export const settleCommissionReservation = async (
    workerId: string | mongoose.Types.ObjectId,
    bookingId: string | mongoose.Types.ObjectId,
    paymentId: string | mongoose.Types.ObjectId,
    fallbackAmount: number,
    options: ReservationOptions = {}
) => {
    const { session } = options;
    const existingTransaction = await WalletTransaction.findOne({
        type: 'commission_deduction',
        'reference.payment': paymentId
    }).session(session ?? null);
    if (existingTransaction) return existingTransaction;

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
        description: `Commission deduction for booking ID: ${bookingId}`,
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
