import UserWallet, { IUserWallet } from '../models/UserWallet';
import UserWalletTransaction, { IUserWalletTransaction, UserActorType, UserWalletTransactionType } from '../models/UserWalletTransaction';
import mongoose from 'mongoose';

/**
 * Get or create wallet for a customer/user
 */
export const getOrCreateUserWallet = async (
    userId: string | mongoose.Types.ObjectId,
    session?: mongoose.ClientSession
): Promise<IUserWallet> => {
    let wallet = await UserWallet.findOne({ user: userId }).session(session ?? null);
    if (!wallet) {
        const [createdWallet] = await UserWallet.create([{
            user: userId,
            balance: 0,
            isActive: true
        }], session ? { session } : {});
        wallet = createdWallet || null;
    }
    if (!wallet) throw new Error('Unable to create customer wallet');
    return wallet;
};

/**
 * Get wallet balance for a user
 */
export const getUserWalletBalance = async (
    userId: string | mongoose.Types.ObjectId,
    session?: mongoose.ClientSession
): Promise<number> => {
    const wallet = await getOrCreateUserWallet(userId, session);
    return wallet.balance;
};

/**
 * Credit customer's wallet balance and record a ledger transaction
 */
export const creditUserWallet = async (
    userId: string | mongoose.Types.ObjectId,
    amount: number,
    performedBy: { actor: string | mongoose.Types.ObjectId; actorType: UserActorType },
    description = 'Wallet Credit',
    reference?: { booking?: string | mongoose.Types.ObjectId; dispute?: string | mongoose.Types.ObjectId },
    session?: mongoose.ClientSession
): Promise<IUserWallet> => {
    if (amount <= 0) {
        throw new Error('Credit amount must be greater than zero');
    }

    const wallet = await getOrCreateUserWallet(userId, session);
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore + amount;

    const updatedWallet = await UserWallet.findOneAndUpdate(
        { user: userId },
        { $inc: { balance: amount } },
        { new: true, ...(session ? { session } : {}) }
    );

    if (!updatedWallet) {
        throw new Error('Unable to update customer wallet balance');
    }

    const refPayload: any = {};
    if (reference?.booking) refPayload.booking = new mongoose.Types.ObjectId(reference.booking);
    if (reference?.dispute) refPayload.dispute = new mongoose.Types.ObjectId(reference.dispute);

    await UserWalletTransaction.create([{
        wallet: updatedWallet._id,
        user: userId,
        type: 'refund',
        amount,
        balanceBefore,
        balanceAfter,
        description,
        reference: refPayload,
        performedBy: {
            actor: new mongoose.Types.ObjectId(performedBy.actor),
            actorType: performedBy.actorType
        }
    }], session ? { session } : {});

    return updatedWallet;
};

/**
 * Get transaction history for a customer/user
 */
export const getCustomerTransactionHistory = async (
    userId: string | mongoose.Types.ObjectId,
    page = 1,
    limit = 10
) => {
    const skip = (page - 1) * limit;

    const transactions = await UserWalletTransaction.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    const total = await UserWalletTransaction.countDocuments({ user: userId });

    return {
        transactions,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
    };
};
