import mongoose from 'mongoose';
import PushToken from '../models/PushToken';
import Notification, { NotificationDeliveryStatus } from '../models/Notifications';
import Workers from '../models/Workers';
import User from '../models/User';
import { sendMultiplePushNotifications } from './fcmService';
import logger from '../config/logger';

type NotificationKind =
  | 'booking_accepted'
  | 'booking_cancelled'
  | 'job_started'
  | 'job_completed'
  | 'payment_received'
  | 'new_review'
  | 'worker_verified'
  | 'wallet_topup'
  | 'weekly_earnings'
  | 'general';

type NotificationOptions = {
  type?: NotificationKind;
  icon?: string;
  color?: string;
  idempotencyKey?: string;
  scheduledAt?: Date;
};

/**
 * Sends a push notification and saves a database notification record for a recipient user or worker.
 * Combines both the direct fcmToken on their document and any active registered devices in PushToken.
 * 
 * @param recipientId ObjectId of the User or Worker
 * @param recipientType 'user' | 'worker'
 * @param title The title of the push notification
 * @param body The body message of the push notification
 * @param data Optional payload data map (keys & values must be strings)
 */
export const sendNotificationToRecipient = async (
  recipientId: string | mongoose.Types.ObjectId,
  recipientType: 'user' | 'worker',
  title: string,
  body: string,
  data?: Record<string, string>,
  options?: NotificationOptions
) => {
  try {
    const recipientStr = recipientId.toString();
    if (options?.idempotencyKey) {
      const existing = await Notification.findOne({ idempotencyKey: options.idempotencyKey }).select('_id').lean();
      if (existing) {
        return { success: true, notificationId: existing._id, skipped: true, fcmResult: null };
      }
    }

    // 1. Fetch direct fcmToken from their document
    let directFcmToken: string | undefined = undefined;
    try {
      if (recipientType === 'worker') {
        const w = await Workers.findById(recipientStr).select('fcmToken');
        directFcmToken = w?.fcmToken;
      } else {
        const u = await User.findById(recipientStr).select('fcmToken');
        directFcmToken = u?.fcmToken;
      }
    } catch (modelErr: any) {
      logger.warn(`Failed to fetch direct fcmToken for ${recipientType} ${recipientStr}: ${modelErr.message}`);
    }

    // 2. Fetch active tokens from PushToken collection
    let pushTokens: any[] = [];
    try {
      pushTokens = await (PushToken as any).find({ user: recipientStr, isActive: true });
    } catch (dbErr: any) {
      logger.warn(`Failed to fetch PushToken records for ${recipientType} ${recipientStr}: ${dbErr.message}`);
    }

    // 3. Combine unique valid tokens
    const tokens = new Set<string>();
    if (directFcmToken && directFcmToken.length >= 100) {
      tokens.add(directFcmToken);
    }
    pushTokens.forEach((pt: any) => {
      if (pt.token && pt.token.length >= 100) {
        tokens.add(pt.token);
      }
    });

    const tokenList = Array.from(tokens);
    let deliveryStatus = NotificationDeliveryStatus.CREATED;
    let fcmResult = null;

    if (tokenList.length > 0) {
      logger.info(`Sending push notification to ${recipientType} ${recipientStr} using ${tokenList.length} token(s)`);
      fcmResult = await sendMultiplePushNotifications(tokenList, title, body, {
        ...(data || {}),
        recipientType,
        recipientId: recipientStr,
      });

      if (fcmResult.successCount > 0) {
        deliveryStatus = NotificationDeliveryStatus.SENT;
      } else {
        deliveryStatus = NotificationDeliveryStatus.FAILED;
      }

      // Auto-deactivate tokens that FCM confirmed are invalid
      if (fcmResult.invalidTokens && fcmResult.invalidTokens.length > 0) {
        try {
          await (PushToken as any).updateMany(
            { token: { $in: fcmResult.invalidTokens } },
            { isActive: false }
          );
          logger.info(`Deactivated ${fcmResult.invalidTokens.length} invalid tokens for recipient ${recipientStr}`);
        } catch (deactivateErr: any) {
          logger.warn(`Failed to deactivate invalid tokens: ${deactivateErr.message}`);
        }
      }
    } else {
      logger.warn(`No active push tokens found for ${recipientType} ${recipientStr}`);
    }

    // 4. Create in-app notification record in DB
    const notification = await Notification.create({
      recipient: new mongoose.Types.ObjectId(recipientStr),
      recipientType,
      title,
      message: body,
      type: options?.type || 'general',
      icon: options?.icon,
      color: options?.color,
      isRead: false,
      deliveryStatus,
      sentAt: deliveryStatus === NotificationDeliveryStatus.SENT ? new Date() : undefined,
      scheduledAt: options?.scheduledAt,
      idempotencyKey: options?.idempotencyKey,
      retryCount: 0,
      error: (fcmResult?.error as any)?.message || undefined
    });

    logger.info(`Notification DB record created: ${notification._id} for ${recipientType} ${recipientStr}`);
    return { success: true, notificationId: notification._id, fcmResult };
  } catch (error: any) {
    logger.error(`Error in sendNotificationToRecipient: ${error.message}`, { error });
    return { success: false, error: error.message };
  }
};
