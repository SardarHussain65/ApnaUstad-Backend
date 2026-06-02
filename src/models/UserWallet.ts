import mongoose, { Schema, Document } from 'mongoose';

export interface IUserWallet extends Document {
    user: mongoose.Types.ObjectId;
    balance: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const userWalletSchema = new Schema<IUserWallet>(
    {
        user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
        balance: { type: Number, required: true, default: 0, min: 0 },
        isActive: { type: Boolean, required: true, default: true }
    },
    { timestamps: true }
);

userWalletSchema.index({ user: 1 });
userWalletSchema.index({ balance: 1 });

export default mongoose.models.UserWallet || mongoose.model<IUserWallet>('UserWallet', userWalletSchema);
