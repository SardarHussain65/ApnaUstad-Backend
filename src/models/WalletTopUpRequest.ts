import mongoose, { Schema, Document } from 'mongoose';

export type WalletTopUpMethod = 'easypaisa' | 'jazzcash' | 'bank_transfer' | 'other';
export type WalletTopUpStatus = 'pending' | 'approved' | 'rejected';

export interface IWalletTopUpRequest extends Document {
    requestId: string;
    worker: mongoose.Types.ObjectId;
    wallet: mongoose.Types.ObjectId;
    amount: number;
    method: WalletTopUpMethod;
    proofImageUrl: string;
    status: WalletTopUpStatus;
    paymentDetailsSnapshot: {
        method: string;
        label: string;
        accountTitle?: string;
        accountNumber?: string;
        bankName?: string;
        iban?: string;
        instructions?: string;
    };
    admin?: mongoose.Types.ObjectId | null;
    adminNotes?: string;
    rejectionReason?: string;
    approvedAt?: Date | null;
    rejectedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const walletTopUpRequestSchema = new Schema<IWalletTopUpRequest>(
    {
        requestId: { type: String, required: true, unique: true, index: true },
        worker: { type: Schema.Types.ObjectId, ref: 'Worker', required: true, index: true },
        wallet: { type: Schema.Types.ObjectId, ref: 'WorkerWallet', required: true },
        amount: { type: Number, required: true, min: 1 },
        method: {
            type: String,
            enum: ['easypaisa', 'jazzcash', 'bank_transfer', 'other'],
            required: true,
            index: true
        },
        proofImageUrl: { type: String, required: true, trim: true },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending',
            required: true,
            index: true
        },
        paymentDetailsSnapshot: {
            method: { type: String, required: true },
            label: { type: String, required: true },
            accountTitle: { type: String, default: '' },
            accountNumber: { type: String, default: '' },
            bankName: { type: String, default: '' },
            iban: { type: String, default: '' },
            instructions: { type: String, default: '' }
        },
        admin: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
        adminNotes: { type: String, trim: true, default: '' },
        rejectionReason: { type: String, trim: true, default: '' },
        approvedAt: { type: Date, default: null },
        rejectedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

walletTopUpRequestSchema.index({ worker: 1, createdAt: -1 });
walletTopUpRequestSchema.index({ status: 1, createdAt: -1 });
walletTopUpRequestSchema.index({ method: 1, status: 1 });

export default mongoose.models.WalletTopUpRequest || mongoose.model<IWalletTopUpRequest>('WalletTopUpRequest', walletTopUpRequestSchema);
