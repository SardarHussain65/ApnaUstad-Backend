// src/models/UserPromoUsage.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IUserPromoUsage extends Document {
  user: mongoose.Types.ObjectId;
  promoCode: mongoose.Types.ObjectId;
  booking: mongoose.Types.ObjectId;
  usedAt: Date;
}

const userPromoUsageSchema = new Schema<IUserPromoUsage>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    promoCode: { type: Schema.Types.ObjectId, ref: 'PromoCode', required: true, index: true },
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    usedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Compound index for optimizing checking user usage limit
userPromoUsageSchema.index({ user: 1, promoCode: 1 });
userPromoUsageSchema.index({ booking: 1 });

export default mongoose.models.UserPromoUsage || mongoose.model<IUserPromoUsage>('UserPromoUsage', userPromoUsageSchema);
