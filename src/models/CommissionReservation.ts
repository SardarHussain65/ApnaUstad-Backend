import mongoose, { Document, Schema } from 'mongoose';

export type CommissionReservationStatus = 'held' | 'settled' | 'released';

export interface ICommissionReservation extends Document {
    worker: mongoose.Types.ObjectId;
    wallet: mongoose.Types.ObjectId;
    booking: mongoose.Types.ObjectId;
    jobPost?: mongoose.Types.ObjectId | null;
    bid?: mongoose.Types.ObjectId | null;
    amount: number;
    commissionRateSnapshot: number;
    status: CommissionReservationStatus;
    settledAt?: Date | null;
    releasedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const commissionReservationSchema = new Schema<ICommissionReservation>(
    {
        worker: { type: Schema.Types.ObjectId, ref: 'Worker', required: true },
        wallet: { type: Schema.Types.ObjectId, ref: 'WorkerWallet', required: true },
        booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
        jobPost: { type: Schema.Types.ObjectId, ref: 'JobPost', default: null },
        bid: { type: Schema.Types.ObjectId, ref: 'JobBid', default: null },
        amount: { type: Number, required: true, min: 0 },
        commissionRateSnapshot: { type: Number, required: true, min: 0, max: 100 },
        status: {
            type: String,
            enum: ['held', 'settled', 'released'],
            default: 'held',
            required: true
        },
        settledAt: { type: Date, default: null },
        releasedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

commissionReservationSchema.index({ worker: 1, status: 1, createdAt: -1 });
commissionReservationSchema.index({ status: 1, createdAt: -1 });

export default mongoose.models.CommissionReservation
    || mongoose.model<ICommissionReservation>('CommissionReservation', commissionReservationSchema);
