// src/models/PromoCode.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IPromoCode extends Document {
  code: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  minBookingAmount: number;
  maxDiscountAmount: number;
  startDate: Date;
  endDate: Date;
  usageLimit: number;
  usageCount: number;
  userUsageLimit: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const promoCodeSchema = new Schema<IPromoCode>(
  {
    code: { 
      type: String, 
      required: true, 
      unique: true, 
      uppercase: true, 
      trim: true, 
      index: true 
    },
    discountType: { 
      type: String, 
      enum: ['percentage', 'fixed'], 
      required: true 
    },
    discountValue: { 
      type: Number, 
      required: true, 
      min: 0 
    },
    minBookingAmount: { 
      type: Number, 
      default: 0, 
      min: 0 
    },
    maxDiscountAmount: { 
      type: Number, 
      default: 0, 
      min: 0 
    },
    startDate: { 
      type: Date, 
      required: true 
    },
    endDate: { 
      type: Date, 
      required: true 
    },
    usageLimit: { 
      type: Number, 
      default: 0, 
      min: 0 
    },
    usageCount: { 
      type: Number, 
      default: 0, 
      min: 0 
    },
    userUsageLimit: { 
      type: Number, 
      default: 1, 
      min: 1 
    },
    isActive: { 
      type: Boolean, 
      default: true,
      index: true 
    }
  },
  { timestamps: true }
);

promoCodeSchema.index({ startDate: 1, endDate: 1 });
promoCodeSchema.index({ createdAt: -1 });

export default mongoose.models.PromoCode || mongoose.model<IPromoCode>('PromoCode', promoCodeSchema);
