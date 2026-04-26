// src/models/Workers.ts
import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcrypt';

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
    isVerified: boolean;
    isActive: boolean;
    rating: number;
    totalReviews: number;
    totalJobs: number;
    totalEarnings: number;
    fcmToken?: string;
    refreshToken?: string;
    isPasswordCorrect(password: string): Promise<boolean>;
}

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
        isVerified: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true },
        rating: { type: Number, default: 0, min: 0, max: 5 },
        totalReviews: { type: Number, default: 0 },
        totalJobs: { type: Number, default: 0 },
        totalEarnings: { type: Number, default: 0 },
        fcmToken: { type: String, default: '' },
        refreshToken: { type: String, default: '' }
    },
    { timestamps: true }
);

workerSchema.index({ location: '2dsphere' });
workerSchema.index({ category: 1, isAvailable: 1, isVerified: 1 });
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
