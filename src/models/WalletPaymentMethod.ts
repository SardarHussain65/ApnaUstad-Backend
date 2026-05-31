import mongoose, { Schema, Document } from 'mongoose';
import { WalletTopUpMethod } from './WalletTopUpRequest';

export interface IWalletPaymentMethod extends Document {
    method: WalletTopUpMethod;
    label: string;
    accountTitle: string;
    accountNumber: string;
    bankName: string;
    iban: string;
    instructions: string;
    enabled: boolean;
    sortOrder: number;
    updatedBy?: mongoose.Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

const walletPaymentMethodSchema = new Schema<IWalletPaymentMethod>(
    {
        method: {
            type: String,
            enum: ['easypaisa', 'jazzcash', 'bank_transfer', 'other'],
            required: true,
            unique: true,
            index: true,
        },
        label: { type: String, required: true, trim: true },
        accountTitle: { type: String, trim: true, default: '' },
        accountNumber: { type: String, trim: true, default: '' },
        bankName: { type: String, trim: true, default: '' },
        iban: { type: String, trim: true, uppercase: true, default: '' },
        instructions: { type: String, trim: true, default: '' },
        enabled: { type: Boolean, default: true },
        sortOrder: { type: Number, default: 0 },
        updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    },
    { timestamps: true }
);

export default mongoose.models.WalletPaymentMethod || mongoose.model<IWalletPaymentMethod>('WalletPaymentMethod', walletPaymentMethodSchema);
