// src/models/Booking.ts
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IBooking extends Document {
    jobPost?: mongoose.Types.ObjectId | null;
    acceptedBid?: mongoose.Types.ObjectId | null;
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
    bookingType: 'instant' | 'scheduled';
    expiresAt: Date;
    workerRespondedAt?: Date | null;
    completedAt?: Date | null;
    paymentStatus: 'unpaid' | 'paid' | 'refunded';
    paymentMethod: 'card' | 'cash' | 'easypaisa';
    stripePaymentId?: string | null;
    cancelledBy?: 'customer' | 'worker' | 'admin' | null;
    cancelReason?: string;
    isReviewed: boolean;
    imageUrls: string[];
    videoUrls: string[];
    audioUrls: string[];
    agreement?: {
        clientOffer: number;
        agreedPrice: number;
        cashDue: number;
        priceSource: 'accepted_offer' | 'counter_offer' | 'direct_rate';
        commissionRateSnapshot: number;
        commissionAmount: number;
        workerNetIncome: number;
        promoCode?: string;
        discountAmount?: number;
        lockedAt: Date;
        pricingVersion: number;
    };
    pricingType?: 'fixed' | 'open';
    commissionDeducted?: boolean;
    pendingPriceIncrease?: {
        revisedPrice: number;
        reason: string;
        requestedAt: Date;
        additionalCommission: number;
    } | null;
    priceRevisionHistory?: Array<{
        previousPrice: number;
        revisedPrice: number;
        reason: string;
        customerApproved: boolean;
        approvedAt?: Date;
        requestedAt: Date;
        previousCommission: number;
        additionalCommission: number;
        status: 'pending' | 'approved' | 'rejected';
    }>;
    customerReductionRequest?: {
        requestedAmount: number;
        reason: string;
        status: 'pending' | 'approved' | 'rejected';
        requestedAt: Date;
        adminNotes?: string;
        resolvedAt?: Date;
    } | null;
    finalSettlement?: {
        customerDeclaredAmount?: number;
        extraCommissionDeducted?: number;
        verifiedAt?: Date;
    };
    fraudSignals?: {
        durationMinutesOnSite?: number;
        isFlaggedForAudit?: boolean;
        flagReason?: string;
        flaggedAt?: Date;
    };
}

const bookingSchema = new Schema<IBooking>(
    {
        jobPost: { type: Schema.Types.ObjectId, ref: 'JobPost', default: null },
        acceptedBid: { type: Schema.Types.ObjectId, ref: 'JobBid', default: null },
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
        bookingType: {
            type: String,
            enum: ['instant', 'scheduled'],
            default: 'scheduled'
        },
        expiresAt: {
            type: Date,
            required: true
        },
        workerRespondedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'ongoing', 'completed', 'cancelled'],
            default: 'pending'
        },
        paymentStatus: { type: String, enum: ['unpaid', 'paid', 'refunded'], default: 'unpaid' },
        paymentMethod: { type: String, enum: ['card', 'cash', 'easypaisa'], default: 'cash' },
        stripePaymentId: { type: String, default: null },
        cancelledBy: { type: String, enum: ['customer', 'worker', 'admin', null], default: null },
        cancelReason: { type: String, default: '' },
        isReviewed: { type: Boolean, default: false },
        imageUrls: { type: [String], default: [] },
        videoUrls: { type: [String], default: [] },
        audioUrls: { type: [String], default: [] },
        agreement: {
            clientOffer: { type: Number, min: 0, default: 0 },
            agreedPrice: { type: Number, min: 0, default: 0 },
            cashDue: { type: Number, min: 0, default: 0 },
            priceSource: {
                type: String,
                enum: ['accepted_offer', 'counter_offer', 'direct_rate'],
                default: 'direct_rate'
            },
            commissionRateSnapshot: { type: Number, min: 0, max: 100, default: 0 },
            commissionAmount: { type: Number, min: 0, default: 0 },
            workerNetIncome: { type: Number, min: 0, default: 0 },
            promoCode: { type: String, trim: true, default: null },
            discountAmount: { type: Number, min: 0, default: 0 },
            lockedAt: { type: Date, default: Date.now },
            pricingVersion: { type: Number, default: 2 }
        },
        pricingType: { type: String, enum: ['fixed', 'open'], default: 'fixed' },
        commissionDeducted: { type: Boolean, default: false },
        pendingPriceIncrease: {
            revisedPrice: { type: Number },
            reason: { type: String, trim: true },
            requestedAt: { type: Date },
            additionalCommission: { type: Number }
        },
        priceRevisionHistory: [
            {
                previousPrice: { type: Number },
                revisedPrice: { type: Number },
                reason: { type: String, trim: true },
                customerApproved: { type: Boolean, default: false },
                approvedAt: { type: Date },
                requestedAt: { type: Date, default: Date.now },
                previousCommission: { type: Number },
                additionalCommission: { type: Number },
                status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
            }
        ],
        customerReductionRequest: {
            type: new mongoose.Schema({
                requestedAmount: { type: Number, required: true },
                reason: { type: String, trim: true },
                status: { type: String, enum: ['pending', 'approved', 'rejected'] },
                requestedAt: { type: Date },
                adminNotes: { type: String, trim: true },
                resolvedAt: { type: Date }
            }, { _id: false }),
            default: undefined,
            required: false
        },
        finalSettlement: {
            type: new mongoose.Schema({
                customerDeclaredAmount: { type: Number },
                extraCommissionDeducted: { type: Number, default: 0 },
                verifiedAt: { type: Date },
                unauthorizedExtraDemanded: { type: Boolean, default: false },
                customerFeedback: { type: String, trim: true },
                reportedStatus: { type: String }
            }, { _id: false }),
            default: null
        },
        fraudSignals: {
            durationMinutesOnSite: { type: Number, default: 0 },
            isFlaggedForAudit: { type: Boolean, default: false },
            flagReason: { type: String, trim: true },
            flaggedAt: { type: Date }
        }
    },
    { timestamps: true }
);
bookingSchema.index({ customer: 1, status: 1 });
bookingSchema.index({ worker: 1, status: 1 });
bookingSchema.index({ jobPost: 1 }, { unique: true, sparse: true });
bookingSchema.index({ customer: 1, createdAt: -1 });
bookingSchema.index({ worker: 1, createdAt: -1 });
bookingSchema.index({ worker: 1, status: 1, updatedAt: -1 });
bookingSchema.index({ worker: 1, status: 1, completedAt: -1 });
bookingSchema.index({ scheduledDate: 1 });

export default mongoose.models.Booking || mongoose.model<IBooking>('Booking', bookingSchema);
