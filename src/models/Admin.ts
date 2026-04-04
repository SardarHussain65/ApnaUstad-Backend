import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcrypt';

export interface IAdmin extends Document {
    fullName: string;
    email: string;
    password?: string;
    role: 'superadmin' | 'admin';
    lastLogin?: Date;
    isPasswordCorrect(password: string): Promise<boolean>;
}

const adminSchema = new Schema<IAdmin>(
    {
        fullName: { type: String, required: true, trim: true },
        email: { 
            type: String, 
            required: [true, 'Email is required'], 
            unique: true, 
            trim: true, 
            lowercase: true 
        },
        password: { 
            type: String, 
            required: [true, 'Password is required'], 
            trim: true, 
            select: false 
        },
        role: { 
            type: String, 
            enum: ['superadmin', 'admin'], 
            default: 'admin' 
        },
        lastLogin: { type: Date }
    },
    { timestamps: true }
);

/**
 * Pre-save hook to hash password before saving to database
 */
adminSchema.pre('save', async function (this: IAdmin) {
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
adminSchema.methods.isPasswordCorrect = async function (password: string): Promise<boolean> {
    return await bcrypt.compare(password, this.password);
};

const Admin: Model<IAdmin> = mongoose.models.Admin || mongoose.model<IAdmin>('Admin', adminSchema);
export default Admin;
