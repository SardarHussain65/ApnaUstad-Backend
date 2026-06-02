import Notifications, { NotificationDeliveryStatus } from "../models/Notifications";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { broadcastNotification, type BroadcastTarget } from "../services/notificationBroadcast";
import { sendNotificationToRecipient } from "../services/notificationHelper";
import User from "../models/User";
import Worker from "../models/Workers";
import { v4 as uuidv4 } from 'uuid';

/**
 * Send global or targeted notification to users or workers
 * @route POST /api/v1/admin/notifications/global
 */
export const sendGlobalNotification = asyncHandler(async (_req: AdminAuthRequest, res) => {
    const { target = 'all', title, body, type, recipientId, scheduledAt } = (_req as any).body || {};

    if (!title || !body) {
        return res.status(400).json({
            success: false,
            message: "Title and body are required"
        });
    }

    const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
    if (scheduledAt && (!scheduledDate || Number.isNaN(scheduledDate.getTime()))) {
        return res.status(400).json({
            success: false,
            message: 'Invalid scheduledAt timestamp'
        });
    }
    const isScheduled = Boolean(scheduledDate) && scheduledDate.getTime() > Date.now();
    // If scheduled for future, save to DB with 'created' status and scheduledAt timestamp
    if (isScheduled) {
        const broadcastId = uuidv4();
        let recipients: Array<{ id: string; type: 'user' | 'worker' }> = [];

        if (['user', 'worker'].includes(target)) {
            if (!recipientId) {
                return res.status(400).json({
                    success: false,
                    message: "Recipient ID is required for targeted notifications"
                });
            }
            recipients.push({ id: recipientId, type: target as 'user' | 'worker' });
        } else {
            if (target === 'users' || target === 'all') {
                const users = await User.find({ isActive: true }, { _id: 1 }).lean();
                users.forEach(u => recipients.push({ id: u._id.toString(), type: 'user' }));
            }
            if (target === 'workers' || target === 'all') {
                const workers = await Worker.find({ isActive: true }, { _id: 1 }).lean();
                workers.forEach(w => recipients.push({ id: w._id.toString(), type: 'worker' }));
            }
        }

        if (recipients.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No active recipients found for the target"
            });
        }

        // Insert pending notifications
        const docs = recipients.map(r => ({
            recipient: r.id,
            recipientType: r.type,
            title,
            message: body,
            type: type || 'general',
            isRead: false,
            deliveryStatus: NotificationDeliveryStatus.CREATED,
            broadcastId: ['user', 'worker'].includes(target) ? undefined : broadcastId,
            scheduledAt: scheduledDate
        }));

        await Notifications.insertMany(docs);

        return successResponse(res, 200, "Notification scheduled successfully", {
            scheduledAt: scheduledDate,
            recipientsCount: recipients.length,
            broadcastId: ['user', 'worker'].includes(target) ? null : broadcastId
        });
    }

    // Immediate Delivery
    if (['user', 'worker'].includes(target)) {
        if (!recipientId) {
            return res.status(400).json({
                success: false,
                message: "Recipient ID is required for targeted notifications"
            });
        }
        const result = await sendNotificationToRecipient(recipientId, target as 'user' | 'worker', title, body);
        if (!result.success) {
            return res.status(500).json({
                success: false,
                message: result.error || "Failed to send notification"
            });
        }
        return successResponse(res, 200, "Notification sent successfully", result);
    }

    if (!['all', 'users', 'workers'].includes(target)) {
        return res.status(400).json({
            success: false,
            message: "Invalid target"
        });
    }

    const result = await broadcastNotification({
        target: target as BroadcastTarget,
        title,
        body,
        type: type || 'general'
    });

    return successResponse(res, 200, "Broadcast queued", result);
});

/**
 * Get recent system notifications
 * @route GET /api/v1/admin/notifications
 */
export const getAdminNotifications = asyncHandler(async (req: AdminAuthRequest, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const grouped = req.query.grouped === 'true';

    if (!grouped) {
        const notifications = await Notifications.find({})
            .skip((page - 1) * limit)
            .limit(limit)
            .sort({ createdAt: -1 });

        const total = await Notifications.countDocuments({});

        return successResponse(res, 200, "Notifications fetched successfully", {
            notifications,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit)
            }
        });
    }

    // Grouped notification logs (Aggregation)
    // We group by broadcastId if exists, or group by _id for individual notifications
    const aggregatePipeline: any[] = [
        {
            $group: {
                _id: { $ifNull: ["$broadcastId", "$_id"] },
                isBroadcast: {
                    $cond: [
                        { $and: [{ $ne: ["$broadcastId", null] }, { $ne: ["$broadcastId", undefined] }] },
                        true,
                        false
                    ]
                },
                broadcastId: { $first: "$broadcastId" },
                title: { $first: "$title" },
                message: { $first: "$message" },
                recipientType: { $first: "$recipientType" },
                recipient: { $first: "$recipient" },
                deliveryStatus: { $first: "$deliveryStatus" },
                scheduledAt: { $first: "$scheduledAt" },
                sentAt: { $first: "$sentAt" },
                createdAt: { $first: "$createdAt" },
                totalCount: { $sum: 1 },
                sentCount: { 
                    $sum: { 
                        $cond: [{ $eq: ["$deliveryStatus", "sent"] }, 1, 0] 
                    } 
                },
                readCount: { 
                    $sum: { 
                        $cond: ["$isRead", 1, 0] 
                    } 
                },
                failedCount: { 
                    $sum: { 
                        $cond: [{ $eq: ["$deliveryStatus", "failed"] }, 1, 0] 
                    } 
                }
            }
        },
        { $sort: { createdAt: -1 } }
    ];

    // To get the total count for pagination, we execute a count aggregation first
    const countResult = await Notifications.aggregate([
        {
            $group: {
                _id: { $ifNull: ["$broadcastId", "$_id"] }
            }
        },
        { $count: "count" }
    ]);
    const total = countResult[0]?.count || 0;

    // Apply pagination to aggregation pipeline
    aggregatePipeline.push({ $skip: (page - 1) * limit });
    aggregatePipeline.push({ $limit: limit });

    const notifications = await Notifications.aggregate(aggregatePipeline);

    // Populate recipient details for individual notifications
    const populatedNotifications = await Promise.all(notifications.map(async (n) => {
        if (!n.isBroadcast && n.recipient) {
            let recipientInfo = null;
            if (n.recipientType === 'worker') {
                recipientInfo = await Worker.findById(n.recipient).select('fullName phone email profileImage').lean();
            } else if (n.recipientType === 'user') {
                recipientInfo = await User.findById(n.recipient).select('fullName phone email profileImage').lean();
            }
            return {
                ...n,
                recipient: recipientInfo
            };
        }
        return n;
    }));

    return successResponse(res, 200, "Notifications fetched successfully", {
        notifications: populatedNotifications,
        pagination: {
            total,
            page,
            pages: Math.ceil(total / limit)
        }
    });
});
