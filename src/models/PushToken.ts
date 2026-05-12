// IMPROVED: PushToken.ts model with metrics and lifecycle tracking
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IPushToken extends Document {
  user: mongoose.Types.ObjectId;
  token: string;
  deviceId: string;
  platform: 'ios' | 'android';
  isActive: boolean;
  
  // ✅ NEW: Token lifecycle tracking
  lastUsed: Date;
  lastVerified: Date;
  
  // ✅ NEW: Device metadata
  appVersion?: string;
  osVersion?: string;
  
  // ✅ NEW: Delivery metrics
  successfulSends: number;
  failedSends: number;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface IPushTokenModel extends Model<IPushToken> {
  deactivateStaleTokens(daysInactive?: number): Promise<any>;
  findActiveForUser(userId: string): Promise<IPushToken[]>;
  findActiveOnDevice(deviceId: string): Promise<IPushToken[]>;
  getMetrics(): Promise<any>;
  getHealthReport(): Promise<any>;
}

const pushTokenSchema = new Schema<IPushToken>(
  {
    user: { 
      type: Schema.Types.ObjectId, 
      ref: 'User', 
      required: true,
      index: true
    },
    token: { 
      type: String, 
      required: true, 
      unique: true,
      index: true
    },
    deviceId: { 
      type: String, 
      required: true,
      index: true
    },
    platform: { 
      type: String, 
      enum: ['ios', 'android'], 
      required: true,
      index: true
    },
    isActive: { 
      type: Boolean, 
      default: true,
      index: true
    },
    
    // ✅ NEW: Token lifecycle tracking
    lastUsed: { 
      type: Date, 
      default: Date.now,
      index: true
    },
    lastVerified: {
      type: Date,
      default: Date.now,
      index: true
    },
    
    // ✅ NEW: Device metadata
    appVersion: { 
      type: String,
      sparse: true  // Not all devices report this
    },
    osVersion: { 
      type: String,
      sparse: true  // Not all devices report this
    },
    
    // ✅ NEW: Delivery metrics
    successfulSends: { 
      type: Number, 
      default: 0,
      index: true
    },
    failedSends: { 
      type: Number, 
      default: 0,
      index: true
    }
  },
  { 
    timestamps: true,
    collection: 'pushtokens'
  }
);

// ✅ NEW: Compound indexes for optimal query performance
pushTokenSchema.index({ user: 1, platform: 1, deviceId: 1 });
pushTokenSchema.index({ user: 1, isActive: 1 });  // Find active tokens for user
pushTokenSchema.index({ deviceId: 1, isActive: 1 });  // Find active tokens on device
pushTokenSchema.index({ createdAt: -1 });  // For time-based queries
pushTokenSchema.index({ lastUsed: 1 });  // For finding stale tokens
pushTokenSchema.index({ isActive: 1, lastUsed: 1 });  // For cleanup queries
pushTokenSchema.index({ successfulSends: -1 });  // For performance analysis

// ✅ NEW: TTL index to auto-expire inactive tokens after 90 days
// Uncomment to enable auto-deletion of old inactive tokens
// pushTokenSchema.index(
//   { lastUsed: 1 },
//   { 
//     expireAfterSeconds: 7776000,  // 90 days
//     partialFilterExpression: { isActive: false }  // Only expire inactive ones
//   }
// );

// ✅ NEW: Pre-save hook for validation
pushTokenSchema.pre('save', async function(this: IPushToken) {
  // Update lastVerified whenever token is saved
  this.lastVerified = new Date();
  
  // If token becomes active, update lastUsed
  if (this.isModified('isActive') && this.isActive) {
    this.lastUsed = new Date();
  }
});

// ✅ NEW: Instance method to mark token as used
pushTokenSchema.methods.markAsUsed = async function() {
  this.lastUsed = new Date();
  this.lastVerified = new Date();
  return this.save();
};

// ✅ NEW: Instance method to record successful send
pushTokenSchema.methods.recordSuccessfulSend = async function() {
  this.successfulSends += 1;
  this.lastUsed = new Date();
  this.lastVerified = new Date();
  return this.save();
};

// ✅ NEW: Instance method to record failed send
pushTokenSchema.methods.recordFailedSend = async function() {
  this.failedSends += 1;
  this.lastVerified = new Date();
  
  // If too many failures, deactivate
  const successRate = this.successfulSends / (this.successfulSends + this.failedSends);
  if (successRate < 0.1 && this.failedSends > 5) {
    // Less than 10% success rate and more than 5 failures
    this.isActive = false;
  }
  
  return this.save();
};

// ✅ NEW: Static method to deactivate old tokens
pushTokenSchema.statics.deactivateStaleTokens = async function(daysInactive = 90) {
  const cutoffDate = new Date(Date.now() - daysInactive * 24 * 60 * 60 * 1000);
  
  const result = await (this as any).updateMany(
    {
      lastUsed: { $lt: cutoffDate },
      isActive: true
    },
    {
      isActive: false,
      lastVerified: new Date()
    }
  );
  
  return result;
};

// ✅ NEW: Static method to find active tokens for user
pushTokenSchema.statics.findActiveForUser = async function(userId: string) {
  return (this as any).find({
    user: userId,
    isActive: true
  });
};

// ✅ NEW: Static method to find active tokens on device
pushTokenSchema.statics.findActiveOnDevice = async function(deviceId: string) {
  return (this as any).find({
    deviceId,
    isActive: true
  });
};

// ✅ NEW: Static method to get token metrics
pushTokenSchema.statics.getMetrics = async function() {
  const results = await (this as any).aggregate([
    {
      $group: {
        _id: null,
        totalTokens: { $sum: 1 },
        activeTokens: {
          $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
        },
        inactiveTokens: {
          $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] }
        },
        avgSuccessfulSends: { $avg: '$successfulSends' },
        avgFailedSends: { $avg: '$failedSends' },
        androidTokens: {
          $sum: { $cond: [{ $eq: ['$platform', 'android'] }, 1, 0] }
        },
        iosTokens: {
          $sum: { $cond: [{ $eq: ['$platform', 'ios'] }, 1, 0] }
        }
      }
    }
  ]);
  
  return results[0] || {
    totalTokens: 0,
    activeTokens: 0,
    inactiveTokens: 0,
    avgSuccessfulSends: 0,
    avgFailedSends: 0,
    androidTokens: 0,
    iosTokens: 0
  };
};

// ✅ NEW: Static method to get token health report
pushTokenSchema.statics.getHealthReport = async function() {
  const metrics = await (this as any).getMetrics();
  const staleTokens = await (this as any).countDocuments({
    lastUsed: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
  });
  
  return {
    ...metrics,
    staleTokensCount: staleTokens,
    health: {
      activeRate: metrics.totalTokens > 0 
        ? ((metrics.activeTokens / metrics.totalTokens) * 100).toFixed(1) + '%'
        : 'N/A',
      staleRate: metrics.totalTokens > 0
        ? ((staleTokens / metrics.totalTokens) * 100).toFixed(1) + '%'
        : 'N/A'
    }
  };
};

export default mongoose.models.PushToken || mongoose.model<IPushToken, IPushTokenModel>('PushToken', pushTokenSchema);
