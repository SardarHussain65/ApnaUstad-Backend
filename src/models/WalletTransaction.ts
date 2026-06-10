import mongoose, { Schema, Document } from 'mongoose';

export type WalletTransactionType = 'recharge' | 'commission_deduction' | 'specialty_subscription' | 'refund' | 'adjustment';
export type ActorType = 'worker' | 'admin' | 'system';

export interface IWalletTransaction extends Document {
    wallet: mongoose.Types.ObjectId;
    worker: mongoose.Types.ObjectId;
    type: WalletTransactionType;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    description: string;
    reference?: {
        booking?: mongoose.Types.ObjectId;
        payment?: mongoose.Types.ObjectId;
        topUpRequest?: mongoose.Types.ObjectId;
        category?: mongoose.Types.ObjectId;
        specialty?: mongoose.Types.ObjectId;
        billingPeriodStart?: Date;
        billingPeriodEnd?: Date;
    };
    idempotencyKey?: string;
    performedBy: {
        actor: mongoose.Types.ObjectId;
        actorType: ActorType;
    };
    createdAt: Date;
    updatedAt: Date;
}

const walletTransactionSchema = new Schema<IWalletTransaction>(
    {
        wallet: { type: Schema.Types.ObjectId, ref: 'WorkerWallet', required: true },
        worker: { type: Schema.Types.ObjectId, ref: 'Worker', required: true },
        type: {
            type: String,
            enum: ['recharge', 'commission_deduction', 'specialty_subscription', 'refund', 'adjustment'],
            required: true
        },
        amount: { type: Number, required: true, min: 0 },
        balanceBefore: { type: Number, required: true },
        balanceAfter: { type: Number, required: true },
        description: { type: String, required: true, trim: true },
        reference: {
            booking: { type: Schema.Types.ObjectId, ref: 'Booking', default: undefined },
            payment: { type: Schema.Types.ObjectId, ref: 'Payment', default: undefined },
            topUpRequest: { type: Schema.Types.ObjectId, ref: 'WalletTopUpRequest', default: undefined },
            category: { type: Schema.Types.ObjectId, ref: 'Category', default: undefined },
            specialty: { type: Schema.Types.ObjectId, default: undefined },
            billingPeriodStart: { type: Date, default: undefined },
            billingPeriodEnd: { type: Date, default: undefined }
        },
        idempotencyKey: { type: String, trim: true, default: undefined },
        performedBy: {
            actor: { type: Schema.Types.ObjectId, required: true },
            actorType: { type: String, enum: ['worker', 'admin', 'system'], required: true }
        }
    },
    { timestamps: true }
);

walletTransactionSchema.index({ worker: 1, createdAt: -1 });
walletTransactionSchema.index({ wallet: 1, createdAt: -1 });
walletTransactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
walletTransactionSchema.index(
    { type: 1, 'reference.payment': 1 },
    {
        unique: true,
        partialFilterExpression: {
            type: 'commission_deduction',
            'reference.payment': { $exists: true }
        }
    }
);

export default mongoose.models.WalletTransaction || mongoose.model<IWalletTransaction>('WalletTransaction', walletTransactionSchema);
