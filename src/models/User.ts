import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcrypt';

export interface IUser extends Document {
    fullName: string;
    phone: string;
    email?: string | null;
    password?: string;
    profileImage?: string;
    address?: string;
    city?: string;
    location: {
        type: string;
        coordinates: number[];
    };
    fcmToken?: string;
    refreshToken?: string;
    isActive: boolean;
    deactivationReason?: string;
    deactivatedAt?: Date | null;
    deactivatedBy?: mongoose.Types.ObjectId | null;
    reactivatedAt?: Date | null;
    reactivatedBy?: mongoose.Types.ObjectId | null;
    favorites?: mongoose.Types.ObjectId[];
    isPasswordCorrect(password: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
    {
        fullName: { type: String, trim: true, default: '' },
        phone: { type: String, required: [true, 'Phone is required'], unique: true, trim: true },
        email: { type: String, trim: true, lowercase: true, sparse: true, default: null },
        password: { type: String, required: [true, 'Password is required'], trim: true, select: false },
        profileImage: { type: String, default: '' },
        address: { type: String, trim: true, default: '' },
        city: { type: String, trim: true, default: '' },
        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number], default: [0, 0] }
        },
        fcmToken: { type: String, default: '' },
        refreshToken: { type: String, default: '' },
        isActive: { type: Boolean, default: true },
        deactivationReason: { type: String, trim: true, maxlength: 500, default: '' },
        deactivatedAt: { type: Date, default: null },
        deactivatedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
        reactivatedAt: { type: Date, default: null },
        reactivatedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
        favorites: { type: [{ type: Schema.Types.ObjectId, ref: 'Worker' }], default: [] },
    },
    { timestamps: true }
);

userSchema.index({ location: '2dsphere' });

/**
 * Pre-save hook to hash password before saving to database
 */
userSchema.pre('save', async function (this: IUser) {
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
userSchema.methods.isPasswordCorrect = async function (password: string): Promise<boolean> {
    return await bcrypt.compare(password, this.password);
};

const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', userSchema);
export default User;
