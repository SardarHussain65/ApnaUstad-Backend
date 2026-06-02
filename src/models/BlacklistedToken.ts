import mongoose, { Schema, Document } from 'mongoose';

export interface IBlacklistedToken extends Document {
  token: string;
  expiresAt: Date;
}

const BlacklistedTokenSchema = new Schema<IBlacklistedToken>(
  {
    token: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, expires: 0 } // TTL Index: automatically deletes document at expiresAt timestamp
  },
  { timestamps: true }
);

// Add simple index for token lookup
BlacklistedTokenSchema.index({ token: 1 });

export const BlacklistedToken = mongoose.models.BlacklistedToken || mongoose.model<IBlacklistedToken>('BlacklistedToken', BlacklistedTokenSchema);

export default BlacklistedToken;
