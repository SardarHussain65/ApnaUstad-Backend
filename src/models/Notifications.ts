// IMPROVED: Notifications.ts model with delivery tracking
import mongoose, { Schema, Document, Model } from 'mongoose';

export enum NotificationDeliveryStatus {
  CREATED = 'created',
  QUEUED = 'queued',
  SENT = 'sent',
  FAILED = 'failed',
  DELIVERED = 'delivered',
  READ = 'read'
}

export interface INotification extends Document {
  recipient: mongoose.Types.ObjectId;
  recipientType: 'user' | 'worker';
  title: string;
  message: string;
  type: 'booking_accepted' | 'booking_cancelled' | 'job_started' | 'job_completed' | 
        'payment_received' | 'new_review' | 'worker_verified' | 'general';
  icon: string;
  color: string;
  booking?: mongoose.Types.ObjectId | null;
  
  // ✅ NEW: Delivery tracking
  deliveryStatus: NotificationDeliveryStatus;
  fcmMessageId?: string;  // For debugging in Firebase console
  sentAt?: Date;
  deliveredAt?: Date;
  retryCount: number;
  lastRetryAt?: Date;
  error?: string;  // Error message if failed
  
  // ✅ NEW: Device tracking
  deviceId?: string;
  
  // ✅ NEW: Read tracking
  isRead: boolean;
  readAt?: Date;
  
  // ✅ NEW: Idempotency
  idempotencyKey?: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    recipient: { 
      type: Schema.Types.ObjectId, 
      ref: 'User',
      required: true,
      index: true 
    },
    recipientType: { 
      type: String, 
      enum: ['user', 'worker'], 
      required: true,
      index: true
    },
    title: { 
      type: String, 
      required: true,
      maxlength: 100,
      minlength: 2
    },
    message: { 
      type: String, 
      required: true,
      maxlength: 500,
      minlength: 1
    },
    type: {
      type: String,
      enum: ['booking_accepted', 'booking_cancelled', 'job_started', 
             'job_completed', 'payment_received', 'new_review', 
             'worker_verified', 'general'],
      default: 'general',
      index: true
    },
    icon: { 
      type: String, 
      default: 'notifications' 
    },
    color: { 
      type: String, 
      default: '#2563EB' 
    },
    booking: { 
      type: Schema.Types.ObjectId, 
      ref: 'Booking', 
      default: null 
    },
    
    // ✅ NEW: Delivery Tracking
    deliveryStatus: {
      type: String,
      enum: Object.values(NotificationDeliveryStatus),
      default: NotificationDeliveryStatus.CREATED,
      index: true
    },
    fcmMessageId: { 
      type: String,
      index: true,  // For quick lookup if FCM has issues
      sparse: true
    },
    sentAt: { 
      type: Date,
      index: true 
    },
    deliveredAt: { 
      type: Date 
    },
    retryCount: { 
      type: Number, 
      default: 0,
      index: true
    },
    lastRetryAt: { 
      type: Date 
    },
    error: { 
      type: String,  // Store error message for debugging
      maxlength: 500
    },
    
    // ✅ NEW: Device Tracking
    deviceId: { 
      type: String,
      sparse: true  // Not all notifications will have this
    },
    
    // ✅ NEW: Read Status
    isRead: { 
      type: Boolean, 
      default: false,
      index: true
    },
    readAt: { 
      type: Date 
    },
    
    // ✅ NEW: Idempotency Key
    idempotencyKey: { 
      type: String,
      unique: true,
      sparse: true,  // Only unique if present
      index: true
    }
  },
  { 
    timestamps: true,
    collection: 'notifications'
  }
);

// ✅ NEW: Compound indexes for optimal query performance
notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, recipientType: 1 });
notificationSchema.index({ recipient: 1, createdAt: -1, isRead: 1 });
notificationSchema.index({ deliveryStatus: 1, retryCount: 1 });  // For finding notifications to retry
notificationSchema.index({ createdAt: -1 });

// ✅ NEW: Text index for searching notifications
notificationSchema.index({ title: 'text', message: 'text' });

// ✅ NEW: Pre-save hook for validation
notificationSchema.pre('save', async function(this: INotification) {
  // Validate sentAt is set before marking as sent
  if (this.deliveryStatus === NotificationDeliveryStatus.SENT && !this.sentAt) {
    this.sentAt = new Date();
  }
  
  // Update lastRetryAt when retrying
  if (this.isModified('retryCount') && this.retryCount > 0) {
    this.lastRetryAt = new Date();
  }
  
  // Clear delivery fields if changing back to created status
  if (this.deliveryStatus === NotificationDeliveryStatus.CREATED) {
    (this as any).sentAt = undefined;
    (this as any).fcmMessageId = undefined;
  }
});

// ✅ NEW: Instance method to mark as delivered
notificationSchema.methods.markAsDelivered = async function() {
  this.deliveryStatus = NotificationDeliveryStatus.DELIVERED;
  this.deliveredAt = new Date();
  return this.save();
};

// ✅ NEW: Instance method to mark as failed
notificationSchema.methods.markAsFailed = async function(errorMessage: string) {
  this.deliveryStatus = NotificationDeliveryStatus.FAILED;
  this.error = errorMessage;
  return this.save();
};

// ✅ NEW: Instance method to increment retry count
notificationSchema.methods.incrementRetry = async function(errorMessage?: string) {
  this.retryCount += 1;
  this.lastRetryAt = new Date();
  if (errorMessage) {
    this.error = errorMessage;
  }
  
  // Mark as failed if max retries reached
  if (this.retryCount >= 3) {
    this.deliveryStatus = NotificationDeliveryStatus.FAILED;
  } else {
    this.deliveryStatus = NotificationDeliveryStatus.QUEUED;
  }
  
  return this.save();
};

// ✅ NEW: Static method to find retryable notifications
notificationSchema.statics.findRetryable = async function(maxRetries = 3) {
  return this.find({
    deliveryStatus: { $in: [NotificationDeliveryStatus.FAILED, NotificationDeliveryStatus.QUEUED] },
    retryCount: { $lt: maxRetries },
    createdAt: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) }  // Last 24 hours
  });
};

export default mongoose.models.Notification || mongoose.model<INotification>('Notification', notificationSchema);
