import mongoose, { Schema, Document } from 'mongoose';

export type UserWalletTransactionType = 'refund' | 'adjustment';
export type UserActorType = 'user' | 'admin';

export interface IUserWalletTransaction extends Document {
    wallet: mongoose.Types.ObjectId;
    user: mongoose.Types.ObjectId;
    type: UserWalletTransactionType;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    description: string;
    reference?: {
        booking?: mongoose.Types.ObjectId;
        dispute?: mongoose.Types.ObjectId;
    };
    performedBy: {
        actor: mongoose.Types.ObjectId;
        actorType: UserActorType;
    };
    createdAt: Date;
    updatedAt: Date;
}

const userWalletTransactionSchema = new Schema<IUserWalletTransaction>(
    {
        wallet: { type: Schema.Types.ObjectId, ref: 'UserWallet', required: true },
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        type: {
            type: String,
            enum: ['refund', 'adjustment'],
            required: true
        },
        amount: { type: Number, required: true, min: 0 },
        balanceBefore: { type: Number, required: true },
        balanceAfter: { type: Number, required: true },
        description: { type: String, required: true, trim: true },
        reference: {
            booking: { type: Schema.Types.ObjectId, ref: 'Booking', default: undefined },
            dispute: { type: Schema.Types.ObjectId, ref: 'Dispute', default: undefined }
        },
        performedBy: {
            actor: { type: Schema.Types.ObjectId, required: true },
            actorType: { type: String, enum: ['user', 'admin'], required: true }
        }
    },
    { timestamps: true }
);

userWalletTransactionSchema.index({ user: 1, createdAt: -1 });
userWalletTransactionSchema.index({ wallet: 1, createdAt: -1 });

export default mongoose.models.UserWalletTransaction || mongoose.model<IUserWalletTransaction>('UserWalletTransaction', userWalletTransactionSchema);
