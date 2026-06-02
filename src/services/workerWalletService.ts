import WorkerWallet, { IWorkerWallet } from '../models/WorkerWallet';
import WalletTransaction, { IWalletTransaction, WalletTransactionType, ActorType } from '../models/WalletTransaction';
import { getWalletSettings } from './walletSettingsService';
import mongoose from 'mongoose';

/**
 * Get or create wallet for a worker
 */
export const getOrCreateWallet = async (
    workerId: string | mongoose.Types.ObjectId,
    session?: mongoose.ClientSession
): Promise<IWorkerWallet> => {
    let wallet = await WorkerWallet.findOne({ worker: workerId }).session(session ?? null);
    if (!wallet) {
        const [createdWallet] = await WorkerWallet.create([{
            worker: workerId,
            balance: 0,
            reservedBalance: 0,
            totalRecharged: 0,
            totalCommissionDeducted: 0,
            isActive: true
        }], session ? { session } : {});
        wallet = createdWallet || null;
    }
    if (!wallet) throw new Error('Unable to create worker wallet');
    return wallet;
};

/**
 * Get wallet balance for a worker
 */
export const getWalletBalance = async (workerId: string | mongoose.Types.ObjectId): Promise<number> => {
    const wallet = await getOrCreateWallet(workerId);
    return wallet.balance;
};

export const calculateCommissionAmount = async (baseAmount: number): Promise<number> => {
    const settings = await getWalletSettings();
    if (!settings.commissionEnabled) return 0;

    const platformFeePercentage = settings.platformFeePercentage || 0;
    return Math.round((Number(baseAmount || 0) * (platformFeePercentage / 100)) * 100) / 100;
};

export const getRequiredWalletBalance = async (estimatedCommission = 0): Promise<number> => {
    const settings = await getWalletSettings();
    const minimumBalance = settings.minimumWalletBalance;
    return Math.max(minimumBalance, Number(estimatedCommission || 0));
};

/**
 * Check if a worker has the minimum balance required
 */
export const hasMinimumBalance = async (
    workerId: string | mongoose.Types.ObjectId,
    minBalance?: number,
    estimatedCommission = 0
): Promise<boolean> => {
    const balance = await getWalletBalance(workerId);
    const requiredMin = minBalance !== undefined ? minBalance : await getRequiredWalletBalance(estimatedCommission);
    return balance >= requiredMin;
};

export const getWalletEligibility = async (
    workerId: string | mongoose.Types.ObjectId,
    estimatedCommission = 0,
    session?: mongoose.ClientSession
) => {
    const wallet = await getOrCreateWallet(workerId, session);
    const requiredBalance = await getRequiredWalletBalance(estimatedCommission);
    const reservedBalance = Number(wallet.reservedBalance || 0);
    const availableBalance = Number(wallet.balance || 0) - reservedBalance;

    return {
        wallet,
        balance: wallet.balance,
        reservedBalance,
        availableBalance,
        requiredBalance,
        estimatedCommission: Number(estimatedCommission || 0),
        isEligible: wallet.isActive && availableBalance >= requiredBalance,
    };
};

export const buildInsufficientBalanceMessage = (requiredBalance: number, currentBalance = 0) => (
    `Insufficient wallet balance. Please recharge your wallet. Required balance: Rs. ${requiredBalance.toLocaleString('en-PK')}. Current balance: Rs. ${currentBalance.toLocaleString('en-PK')}.`
);

/**
 * Recharge a worker's wallet
 */
export const rechargeWallet = async (
    workerId: string | mongoose.Types.ObjectId,
    amount: number,
    performedBy: { actor: string | mongoose.Types.ObjectId; actorType: ActorType },
    description = 'Wallet Recharge',
    reference?: IWalletTransaction['reference'],
    session?: mongoose.ClientSession
): Promise<IWorkerWallet> => {
    if (amount <= 0) {
        throw new Error('Recharge amount must be greater than zero');
    }

    const wallet = await getOrCreateWallet(workerId, session);
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore + amount;

    const updatedWallet = await WorkerWallet.findOneAndUpdate(
        { worker: workerId },
        { 
            $inc: { balance: amount, totalRecharged: amount },
            $set: { lastRechargedAt: new Date() }
        },
        { new: true, ...(session ? { session } : {}) }
    );

    if (!updatedWallet) {
        throw new Error('Unable to update worker wallet');
    }

    await WalletTransaction.create([{
        wallet: updatedWallet._id,
        worker: workerId,
        type: 'recharge',
        amount,
        balanceBefore,
        balanceAfter,
        description,
        ...(reference && { reference }),
        performedBy: {
            actor: new mongoose.Types.ObjectId(performedBy.actor),
            actorType: performedBy.actorType
        }
    }], session ? { session } : {});

    return updatedWallet;
};

/**
 * Deduct commission (platform fee) from a worker's wallet
 */
export const deductCommission = async (
    workerId: string | mongoose.Types.ObjectId,
    commissionAmount: number,
    bookingId: string | mongoose.Types.ObjectId,
    paymentId: string | mongoose.Types.ObjectId,
    session?: mongoose.ClientSession
): Promise<IWorkerWallet> => {
    if (commissionAmount <= 0) {
        // No commission to deduct
        return getOrCreateWallet(workerId, session);
    }

    const existingTransaction = await WalletTransaction.findOne({
        type: 'commission_deduction',
        'reference.payment': paymentId
    }).session(session ?? null);
    if (existingTransaction) {
        return getOrCreateWallet(workerId, session);
    }

    const wallet = await getOrCreateWallet(workerId, session);
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore - commissionAmount;

    const updatedWallet = await WorkerWallet.findOneAndUpdate(
        { worker: workerId },
        { 
            $inc: { balance: -commissionAmount, totalCommissionDeducted: commissionAmount }
        },
        { new: true, ...(session ? { session } : {}) }
    );

    if (!updatedWallet) {
        throw new Error('Unable to update worker wallet');
    }

    await WalletTransaction.create([{
        wallet: updatedWallet._id,
        worker: workerId,
        type: 'commission_deduction',
        amount: commissionAmount,
        balanceBefore,
        balanceAfter,
        description: `Commission deduction for booking ID: ${bookingId}`,
        reference: {
            booking: new mongoose.Types.ObjectId(bookingId),
            payment: new mongoose.Types.ObjectId(paymentId)
        },
        performedBy: {
            actor: new mongoose.Types.ObjectId(workerId),
            actorType: 'worker'
        }
    }], session ? { session } : {});

    return updatedWallet;
};

/**
 * Get transaction history with pagination
 */
export const getTransactionHistory = async (
    workerId: string | mongoose.Types.ObjectId,
    page = 1,
    limit = 10
) => {
    const skip = (page - 1) * limit;
    
    const transactions = await WalletTransaction.find({ worker: workerId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    const total = await WalletTransaction.countDocuments({ worker: workerId });

    return {
        transactions,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
    };
};
