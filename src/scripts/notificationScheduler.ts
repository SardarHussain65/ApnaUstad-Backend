import cron from 'node-cron';
import Notification, { NotificationDeliveryStatus } from '../models/Notifications';
import User from '../models/User';
import Worker from '../models/Workers';
import PushToken from '../models/PushToken';
import { sendMultiplePushNotifications } from '../services/fcmService';
import logger from '../config/logger';

export const startNotificationScheduler = () => {
    // Runs every 1 minute
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            // Fetch notifications that are scheduled and due (status = 'created' and scheduledAt <= now)
            const pending = await Notification.find({
                deliveryStatus: NotificationDeliveryStatus.CREATED,
                scheduledAt: { $lte: now }
            });

            if (pending.length === 0) return;

            logger.info(`🕒 [Scheduler] Found ${pending.length} scheduled notifications to process.`);

            // Group them by broadcastId (if exists) or process individually
            const broadcastGroups: Record<string, typeof pending> = {};
            const individuals: typeof pending = [];

            pending.forEach(n => {
                if (n.broadcastId) {
                    let group = broadcastGroups[n.broadcastId];
                    if (!group) {
                        group = [];
                        broadcastGroups[n.broadcastId] = group;
                    }
                    group.push(n);
                } else {
                    individuals.push(n);
                }
            });

            // Process Broadcast Groups
            for (const [broadcastId, group] of Object.entries(broadcastGroups)) {
                try {
                    const recipientIds = group.map(n => n.recipient);
                    const title = group[0]?.title || '';
                    const body = group[0]?.message || '';
                    const type = group[0]?.type || 'general';

                    // Fetch active push tokens for these users/workers
                    const pushDocs = await (PushToken as any).find({
                        user: { $in: recipientIds },
                        isActive: true
                    }).lean();

                    // Also fetch direct fcmTokens from User/Worker documents
                    const usersDirect = await User.find({ _id: { $in: recipientIds } }).select('fcmToken').lean();
                    const workersDirect = await Worker.find({ _id: { $in: recipientIds } }).select('fcmToken').lean();

                    const tokens = new Set<string>();
                    pushDocs.forEach((doc: any) => {
                        if (doc.token && doc.token.length >= 100) tokens.add(doc.token);
                    });
                    usersDirect.forEach((u: any) => {
                        if (u.fcmToken && u.fcmToken.length >= 100) tokens.add(u.fcmToken);
                    });
                    workersDirect.forEach((w: any) => {
                        if (w.fcmToken && w.fcmToken.length >= 100) tokens.add(w.fcmToken);
                    });

                    const tokenList = Array.from(tokens);

                    if (tokenList.length > 0) {
                        const fcmResult = await sendMultiplePushNotifications(tokenList, title, body, {
                            broadcastId,
                            type
                        });

                        const isSuccess = fcmResult.successCount > 0;
                        const statusUpdate = {
                            deliveryStatus: isSuccess ? NotificationDeliveryStatus.SENT : NotificationDeliveryStatus.FAILED,
                            sentAt: isSuccess ? new Date() : undefined,
                            error: fcmResult.error ? String((fcmResult.error as any).message || fcmResult.error) : undefined
                        };

                        await Notification.updateMany(
                            { broadcastId, deliveryStatus: NotificationDeliveryStatus.CREATED },
                            statusUpdate
                        );

                        // Deactivate invalid tokens
                        if (fcmResult.invalidTokens && fcmResult.invalidTokens.length > 0) {
                            await (PushToken as any).updateMany(
                                { token: { $in: fcmResult.invalidTokens } },
                                { isActive: false }
                            );
                        }

                        logger.info(`[Scheduler] Broadcast ${broadcastId} processed. Sent to ${fcmResult.successCount}/${tokenList.length} tokens.`);
                    } else {
                        // Update status to prevent re-processing
                        await Notification.updateMany(
                            { broadcastId, deliveryStatus: NotificationDeliveryStatus.CREATED },
                            {
                                deliveryStatus: NotificationDeliveryStatus.SENT,
                                sentAt: new Date(),
                                error: 'No active push tokens found for recipients'
                            }
                        );
                        logger.warn(`[Scheduler] Broadcast ${broadcastId} had no push tokens.`);
                    }
                } catch (err: any) {
                    logger.error(`[Scheduler] Error processing broadcast ${broadcastId}:`, err);
                }
            }

            // Process Individual Notifications
            for (const n of individuals) {
                try {
                    const recipientId = n.recipient.toString();
                    const recipientType = n.recipientType;

                    let directFcmToken: string | undefined = undefined;
                    if (recipientType === 'worker') {
                        const w = await Worker.findById(recipientId).select('fcmToken');
                        directFcmToken = w?.fcmToken;
                    } else {
                        const u = await User.findById(recipientId).select('fcmToken');
                        directFcmToken = u?.fcmToken;
                    }

                    const pushDocs = await (PushToken as any).find({ user: recipientId, isActive: true });

                    const tokens = new Set<string>();
                    if (directFcmToken && directFcmToken.length >= 100) {
                        tokens.add(directFcmToken);
                    }
                    pushDocs.forEach((pt: any) => {
                        if (pt.token && pt.token.length >= 100) {
                            tokens.add(pt.token);
                        }
                    });

                    const tokenList = Array.from(tokens);

                    if (tokenList.length > 0) {
                        const fcmResult = await sendMultiplePushNotifications(tokenList, n.title, n.message, {
                            recipientType,
                            recipientId
                        });

                        const isSuccess = fcmResult.successCount > 0;
                        n.deliveryStatus = isSuccess ? NotificationDeliveryStatus.SENT : NotificationDeliveryStatus.FAILED;
                        n.sentAt = isSuccess ? new Date() : undefined;
                        if (fcmResult.error) {
                            n.error = String((fcmResult.error as any).message || fcmResult.error);
                        }
                        await n.save();

                        // Deactivate invalid tokens
                        if (fcmResult.invalidTokens && fcmResult.invalidTokens.length > 0) {
                            await (PushToken as any).updateMany(
                                { token: { $in: fcmResult.invalidTokens } },
                                { isActive: false }
                            );
                        }
                    } else {
                        n.deliveryStatus = NotificationDeliveryStatus.SENT;
                        n.sentAt = new Date();
                        n.error = 'No active push tokens found';
                        await n.save();
                    }
                } catch (err: any) {
                    logger.error(`[Scheduler] Error processing individual notification ${n._id}:`, err);
                }
            }
        } catch (error) {
            logger.error('Error in notificationScheduler cron job:', error);
        }
    });

    logger.info('🕒 Notification Scheduler cron job started (runs every minute)');
};
