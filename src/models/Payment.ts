import mongoose, { Schema, Document } from 'mongoose';

export type PaymentStatus = 'pending' | 'payable' | 'paid' | 'cancelled';
export type PaymentMethod = 'cash';
export type PaymentConfirmedBy = 'customer' | 'worker' | 'admin' | null;

export interface IPayment extends Document {
    booking: mongoose.Types.ObjectId;
    customer: mongoose.Types.ObjectId;
    worker: mongoose.Types.ObjectId;
    method: PaymentMethod;
    status: PaymentStatus;
    currency: 'PKR';
    amount: number;
    subtotal: number;
    platformFee: number;
    workerEarning: number;
    bookingStatusSnapshot: string;
    receiptNumber?: string | null;
    confirmedBy?: PaymentConfirmedBy;
    notes?: string;
    payableAt?: Date | null;
    paidAt?: Date | null;
    cancelledAt?: Date | null;
    workerLedgerApplied: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
    {
        booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
        customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        worker: { type: Schema.Types.ObjectId, ref: 'Worker', required: true },
        method: { type: String, enum: ['cash'], default: 'cash', required: true },
        status: {
            type: String,
            enum: ['pending', 'payable', 'paid', 'cancelled'],
            default: 'pending',
            required: true
        },
        currency: { type: String, enum: ['PKR'], default: 'PKR', required: true },
        amount: { type: Number, required: true, min: 0 },
        subtotal: { type: Number, required: true, min: 0 },
        platformFee: { type: Number, required: true, min: 0 },
        workerEarning: { type: Number, required: true, min: 0 },
        bookingStatusSnapshot: { type: String, default: 'pending' },
        receiptNumber: { type: String, default: null },
        confirmedBy: { type: String, enum: ['customer', 'worker', 'admin', null], default: null },
        notes: { type: String, trim: true, default: '' },
        payableAt: { type: Date, default: null },
        paidAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null },
        workerLedgerApplied: { type: Boolean, default: false },
    },
    { timestamps: true }
);

paymentSchema.index({ customer: 1, status: 1 });
paymentSchema.index({ worker: 1, status: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ paidAt: -1 });
paymentSchema.index({ receiptNumber: 1 }, { sparse: true });

export default mongoose.models.Payment || mongoose.model<IPayment>('Payment', paymentSchema);
