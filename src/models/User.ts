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
    isActive: boolean;
}

const userSchema = new Schema<IUser>(
    {
        fullName: { type: String, trim: true, default: '' },
        phone: { type: String, required: [true, 'Phone is required'], unique: true, trim: true },
        email: { type: String, trim: true, lowercase: true, sparse: true, default: null },
        password: { type: String, required: [true, 'Password is required'], trim: true },
        profileImage: { type: String, default: '' },
        address: { type: String, trim: true, default: '' },
        city: { type: String, trim: true, default: '' },
        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number], default: [0, 0] }
        },
        fcmToken: { type: String, default: '' },
        isActive: { type: Boolean, default: true },
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
