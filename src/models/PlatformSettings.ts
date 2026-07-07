import mongoose, { Schema, Document } from 'mongoose';

export interface UrgentPricingRate {
  baseRatePerHour: number;
  minimumPrice: number;
}

export interface IPlatformSettings extends Document {
  key: 'default';
  urgentPricingRates: Record<string, UrgentPricingRate>;
  defaultUrgentRate: UrgentPricingRate;
  instantJobInitialRadiusKm: number;
  instantJobExpandedRadiusKm: number;
  instantJobExpansionMinutes: number;
  instantJobTimeoutMinutes: number;
  updatedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const urgentRateSchema = new Schema<UrgentPricingRate>(
  {
    baseRatePerHour: { type: Number, required: true, min: 0 },
    minimumPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const platformSettingsSchema = new Schema<IPlatformSettings>(
  {
    key: { type: String, enum: ['default'], default: 'default', unique: true, index: true },
    urgentPricingRates: { type: Schema.Types.Mixed, default: {} },
    defaultUrgentRate: {
      type: urgentRateSchema,
      default: { baseRatePerHour: 450, minimumPrice: 600 },
    },
    instantJobInitialRadiusKm: { type: Number, default: 10, min: 1 },
    instantJobExpandedRadiusKm: { type: Number, default: 25, min: 1 },
    instantJobExpansionMinutes: { type: Number, default: 5, min: 1 },
    instantJobTimeoutMinutes: { type: Number, default: 10, min: 1 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
  },
  { timestamps: true }
);

export default mongoose.models.PlatformSettings
  || mongoose.model<IPlatformSettings>('PlatformSettings', platformSettingsSchema);
