// src/models/Workers.ts
import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcrypt';

export type WorkerSpecialtyApprovalStatus = 'pending' | 'approved' | 'rejected';
export type WorkerSpecialtySubscriptionStatus = 'free' | 'pending_activation' | 'active' | 'payment_due' | 'expired';

export interface IWorkerSpecialty {
    _id: mongoose.Types.ObjectId;
    categoryId: mongoose.Types.ObjectId;
    priority: number;
    skills: string[];
    hourlyRate: number;
    experience: number;
    bio?: string;
    isActive: boolean;
    approvalStatus: WorkerSpecialtyApprovalStatus;
    subscriptionStatus: WorkerSpecialtySubscriptionStatus;
    monthlyFeeSnapshot: number;
    autoRenew: boolean;
    requestedAt: Date;
    approvedAt?: Date | null;
    approvedBy?: mongoose.Types.ObjectId | null;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    nextBillingAt?: Date | null;
    lastChargedAt?: Date | null;
    graceEndsAt?: Date | null;
    billingLockKey?: string;
    billingLockedAt?: Date | null;
}

export interface IWorker extends Document {
    fullName: string;
    phone: string;
    email?: string | null;
    password?: string;
    profileImage?: string;
    cnicNumber?: string;
    cnicFrontImage?: string;
    cnicBackImage?: string;
    category: string;
    specialties: IWorkerSpecialty[];
    skills: string[];
    hourlyRate: number;
    bio?: string;
    experience: number;
    city: string;
    address: string;
    location: {
        type: string;
        coordinates: number[];
    };
    isAvailable: boolean;
    isInstantAvailable: boolean;
    isScheduledAvailable: boolean;
    isVerified: boolean;
    isActive: boolean;
    rating: number;
    totalReviews: number;
    totalJobs: number;
    totalEarnings: number;
    fcmToken?: string;
    refreshToken?: string;
    deactivationReason?: string;
    deactivatedAt?: Date | null;
    deactivatedBy?: mongoose.Types.ObjectId | null;
    reactivatedAt?: Date | null;
    reactivatedBy?: mongoose.Types.ObjectId | null;
    lastOnlineAt?: Date;
    createdAt: Date;
    updatedAt: Date;
    isPasswordCorrect(password: string): Promise<boolean>;
}

const workerSpecialtySchema = new Schema<IWorkerSpecialty>(
    {
        categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
        priority: { type: Number, required: true, min: 1, max: 5 },
        skills: { type: [String], default: [] },
        hourlyRate: { type: Number, min: 0, default: 0 },
        experience: { type: Number, min: 0, default: 0 },
        bio: { type: String, trim: true, maxlength: 500, default: '' },
        isActive: { type: Boolean, default: false },
        approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
        subscriptionStatus: {
            type: String,
            enum: ['free', 'pending_activation', 'active', 'payment_due', 'expired'],
            default: 'pending_activation'
        },
        monthlyFeeSnapshot: { type: Number, min: 0, default: 0 },
        autoRenew: { type: Boolean, default: true },
        requestedAt: { type: Date, default: Date.now },
        approvedAt: { type: Date, default: null },
        approvedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
        currentPeriodStart: { type: Date, default: null },
        currentPeriodEnd: { type: Date, default: null },
        nextBillingAt: { type: Date, default: null },
        lastChargedAt: { type: Date, default: null },
        graceEndsAt: { type: Date, default: null },
        billingLockKey: { type: String, default: '' },
        billingLockedAt: { type: Date, default: null }
    },
    { _id: true }
);

const workerSchema = new Schema<IWorker>(
    {
        fullName: { type: String, trim: true, default: '' },
        phone: { type: String, required: true, unique: true, trim: true },
        email: { type: String, trim: true, lowercase: true, sparse: true, default: null },
        password: { type: String, required: [true, 'Password is required'], trim: true, select: false },
        profileImage: { type: String, default: '' },
        cnicNumber: { type: String, required: true, unique: true, trim: true },
        cnicFrontImage: { type: String, default: '' },
        cnicBackImage: { type: String, default: '' },
        category: { type: String, required: true, trim: true },
        specialties: { type: [workerSpecialtySchema], default: [] },
        skills: { type: [String], default: [] },
        hourlyRate: { type: Number, required: true, min: 100, default: 0 },
        bio: { type: String, trim: true, maxlength: 500, default: '' },
        experience: { type: Number, default: 0, min: 0 },
        city: { type: String, trim: true, default: '' },
        address: { type: String, trim: true, default: '' },
        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number], default: [0, 0] }
        },
        isAvailable: { type: Boolean, default: true },
        isInstantAvailable: { type: Boolean, default: true },
        isScheduledAvailable: { type: Boolean, default: true },
        isVerified: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true },
        rating: { type: Number, default: 0, min: 0, max: 5 },
        totalReviews: { type: Number, default: 0 },
        totalJobs: { type: Number, default: 0 },
        totalEarnings: { type: Number, default: 0 },
        fcmToken: { type: String, default: '' },
        refreshToken: { type: String, default: '' },
        deactivationReason: { type: String, trim: true, maxlength: 500, default: '' },
        deactivatedAt: { type: Date, default: null },
        deactivatedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
        reactivatedAt: { type: Date, default: null },
        reactivatedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
        lastOnlineAt: { type: Date, default: null },
    },
    { timestamps: true }
);

workerSchema.index({ location: '2dsphere' });
workerSchema.index({ category: 1, isAvailable: 1, isVerified: 1 });
workerSchema.index({ category: 1, isInstantAvailable: 1, isScheduledAvailable: 1, isActive: 1 });
workerSchema.index({ 'specialties.categoryId': 1, 'specialties.isActive': 1, isAvailable: 1, isActive: 1 });
workerSchema.index({ 'specialties.nextBillingAt': 1, 'specialties.subscriptionStatus': 1 });
workerSchema.index({ city: 1, isAvailable: 1 });
workerSchema.index({ rating: -1 });

/**
 * Pre-save hook to hash password before saving to database
 */
workerSchema.pre('save', async function (this: IWorker) {
    if (!this.isModified('password')) return;

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password as string, salt);
    } catch (error: any) {
        throw error;
    }
});

/**
 * Method to check if password is correct
 */
workerSchema.methods.isPasswordCorrect = async function (password: string): Promise<boolean> {
    return await bcrypt.compare(password, this.password);
};

export default mongoose.models.Worker || mongoose.model<IWorker>('Worker', workerSchema);
