// src/models/Booking.ts
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IBooking extends Document {
    customer: mongoose.Types.ObjectId;
    worker: mongoose.Types.ObjectId;
    category: string;
    description: string;
    scheduledDate: Date;
    scheduledTime: string;
    estimatedHours: number;
    hourlyRate: number;
    subtotal: number;
    platformFee: number;
    totalAmount: number;
    workerEarning: number;
    address: string;
    location: {
        type: string;
        coordinates: number[];
    };
    status: 'pending' | 'accepted' | 'ongoing' | 'completed' | 'cancelled';
    paymentStatus: 'unpaid' | 'paid';
    paymentMethod: 'card' | 'cash';
    stripePaymentId?: string | null;
    cancelledBy?: 'customer' | 'worker' | 'admin' | null;
    cancelReason?: string;
    isReviewed: boolean;
}

const bookingSchema = new Schema<IBooking>(
    {
        customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        worker: { type: Schema.Types.ObjectId, ref: 'Worker', required: true },
        category: { type: String, required: true },
        description: { type: String, required: true, trim: true, maxlength: 1000 },
        scheduledDate: { type: Date, required: true },
        scheduledTime: { type: String, required: true },
        estimatedHours: { type: Number, required: true, min: 1, max: 8 },
        hourlyRate: { type: Number, required: true },
        subtotal: { type: Number, required: true },
        platformFee: { type: Number, required: true },
        totalAmount: { type: Number, required: true },
        workerEarning: { type: Number, required: true },
        address: { type: String, trim: true, default: '' },
        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number], default: [0, 0] }
        },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'ongoing', 'completed', 'cancelled'],
            default: 'pending'
        },
        paymentStatus: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
        paymentMethod: { type: String, enum: ['card', 'cash'], default: 'cash' },
        stripePaymentId: { type: String, default: null },
        cancelledBy: { type: String, enum: ['customer', 'worker', 'admin', null], default: null },
        cancelReason: { type: String, default: '' },
        isReviewed: { type: Boolean, default: false }
    },
    { timestamps: true }
);
bookingSchema.index({ customer: 1, status: 1 });
bookingSchema.index({ worker: 1, status: 1 });
bookingSchema.index({ scheduledDate: 1 });

export default mongoose.models.Booking || mongoose.model<IBooking>('Booking', bookingSchema);
