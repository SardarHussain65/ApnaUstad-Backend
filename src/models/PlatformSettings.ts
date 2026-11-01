import mongoose, { Schema, Document } from 'mongoose';

export interface IPlatformSettings extends Document {
  key: 'default';
  instantJobInitialRadiusKm: number;
  instantJobExpandedRadiusKm: number;
  instantJobExpansionMinutes: number;
  instantJobTimeoutMinutes: number;
  updatedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const platformSettingsSchema = new Schema<IPlatformSettings>(
  {
    key: { type: String, enum: ['default'], default: 'default', unique: true, index: true },
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
