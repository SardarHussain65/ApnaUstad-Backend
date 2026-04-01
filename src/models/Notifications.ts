// src/models/Notifications.ts
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface INotification extends Document {
    recipient: mongoose.Types.ObjectId;
    recipientType: 'user' | 'worker';
    title: string;
    message: string;
    type: 'booking_accepted' | 'booking_cancelled' | 'job_started' | 'job_completed' | 'payment_received' | 'new_review' | 'worker_verified' | 'general';
    icon: string;
    color: string;
    booking?: mongoose.Types.ObjectId | null;
    isRead: boolean;
}

const notificationSchema = new Schema<INotification>(
    {
        recipient: { type: Schema.Types.ObjectId, required: true },
        recipientType: { type: String, enum: ['user', 'worker'], required: true },
        title: { type: String, required: true },
        message: { type: String, required: true },
        type: {
            type: String,
            enum: ['booking_accepted', 'booking_cancelled', 'job_started', 'job_completed', 'payment_received', 'new_review', 'worker_verified', 'general'],
            default: 'general'
        },
        icon: { type: String, default: 'notifications' },
        color: { type: String, default: '#2563EB' },
        booking: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
        isRead: { type: Boolean, default: false }
    },
    { timestamps: true }
);
notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });

export default mongoose.models.Notification || mongoose.model<INotification>('Notification', notificationSchema);
