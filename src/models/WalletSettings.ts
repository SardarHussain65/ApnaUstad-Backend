import mongoose, { Schema, Document } from 'mongoose';

export interface IWalletSettings extends Document {
    key: 'default';
    platformFeePercentage: number;
    minimumWalletBalance: number;
    commissionEnabled: boolean;
    updatedBy?: mongoose.Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

const walletSettingsSchema = new Schema<IWalletSettings>(
    {
        key: { type: String, enum: ['default'], default: 'default', unique: true, index: true },
        platformFeePercentage: { type: Number, required: true, min: 0, max: 100, default: 10 },
        minimumWalletBalance: { type: Number, required: true, min: 0, default: 500 },
        commissionEnabled: { type: Boolean, default: true },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    },
    { timestamps: true }
);

export default mongoose.models.WalletSettings || mongoose.model<IWalletSettings>('WalletSettings', walletSettingsSchema);
