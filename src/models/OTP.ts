// src/models/OTP.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IOTP extends Document {
    phone?: string | null;
    email?: string | null;
    otp: string;
    createdAt: Date;
}

const otpSchema = new Schema<IOTP>({
    phone: { type: String, default: null },
    email: { type: String, default: null, lowercase: true },
    otp: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 300 } // Deletes after 5 mins
});

otpSchema.pre('save', async function (this: IOTP) {
    if (!this.phone && !this.email) {
        throw new Error('Either phone or email is required');
    }
});

export default mongoose.models.OTP || mongoose.model<IOTP>('OTP', otpSchema);
