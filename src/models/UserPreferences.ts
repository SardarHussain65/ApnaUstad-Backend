import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUserPreferences extends Document {
  userId: mongoose.Types.ObjectId;
  userType: 'user' | 'worker';
  notifications: {
    pushEnabled: boolean;
    emailEnabled: boolean;
    jobAlerts: boolean;
    messages: boolean;
    promos: boolean;
  };
  security: {
    twoFactorEnabled: boolean;
    biometricsEnabled: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const userPreferencesSchema = new Schema<IUserPreferences>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    userType: { type: String, enum: ['user', 'worker'], required: true, index: true },
    notifications: {
      pushEnabled: { type: Boolean, default: true },
      emailEnabled: { type: Boolean, default: false },
      jobAlerts: { type: Boolean, default: true },
      messages: { type: Boolean, default: true },
      promos: { type: Boolean, default: false },
    },
    security: {
      twoFactorEnabled: { type: Boolean, default: false },
      biometricsEnabled: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

userPreferencesSchema.index({ userId: 1, userType: 1 }, { unique: true });

const UserPreferences: Model<IUserPreferences> =
  mongoose.models.UserPreferences || mongoose.model<IUserPreferences>('UserPreferences', userPreferencesSchema);

export default UserPreferences;
