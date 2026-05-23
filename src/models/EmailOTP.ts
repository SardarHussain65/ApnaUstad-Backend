import mongoose, { Schema, Document } from 'mongoose';

export interface IEmailOTP extends Document {
  email: string;
  code: string;
  expiresAt: Date;
}

const EmailOTPSchema = new Schema<IEmailOTP>(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    code: { type: String, required: true, trim: true },
    expiresAt: { type: Date, required: true, expires: 0 } // TTL Index: automatically deletes document at expiresAt timestamp
  },
  { timestamps: true }
);

// Create compound index for highly optimized lookups during verification
EmailOTPSchema.index({ email: 1, code: 1 });

export const EmailOTP = mongoose.models.EmailOTP || mongoose.model<IEmailOTP>('EmailOTP', EmailOTPSchema);

export default EmailOTP;
