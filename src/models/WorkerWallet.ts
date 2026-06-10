import mongoose, { Schema, Document } from 'mongoose';

export interface IWorkerWallet extends Document {
    worker: mongoose.Types.ObjectId;
    balance: number;
    reservedBalance: number;
    totalRecharged: number;
    totalCommissionDeducted: number;
    totalSubscriptionDeducted: number;
    isActive: boolean;
    lastRechargedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const workerWalletSchema = new Schema<IWorkerWallet>(
    {
        worker: { type: Schema.Types.ObjectId, ref: 'Worker', required: true, unique: true },
        balance: { type: Number, required: true, default: 0 },
        reservedBalance: { type: Number, required: true, default: 0, min: 0 },
        totalRecharged: { type: Number, required: true, default: 0 },
        totalCommissionDeducted: { type: Number, required: true, default: 0 },
        totalSubscriptionDeducted: { type: Number, required: true, default: 0 },
        isActive: { type: Boolean, required: true, default: true },
        lastRechargedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

workerWalletSchema.index({ worker: 1 });
workerWalletSchema.index({ balance: 1 });

export default mongoose.models.WorkerWallet || mongoose.model<IWorkerWallet>('WorkerWallet', workerWalletSchema);
