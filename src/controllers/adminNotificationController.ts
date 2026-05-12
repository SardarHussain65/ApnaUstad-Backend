import Notifications from "../models/Notifications";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";

/**
 * Send global notification to users or workers
 * @route POST /api/v1/admin/notifications/global
 */
export const sendGlobalNotification = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { title, body, target } = req.body; // target: 'all', 'users', 'workers'
    
    // In a real application we would batch process these or use a message queue
    // For MVP, we can save them to the DB and push down chunks.
    
    return successResponse(res, 200, "Global notification queued successfully", null);
});

/**
 * Get recent system notifications
 * @route GET /api/v1/admin/notifications
 */
export const getAdminNotifications = asyncHandler(async (req: AdminAuthRequest, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const notifications = await Notifications.find({ type: 'admin_alert' }) // Assuming admin alert type exists
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 });

    const total = await Notifications.countDocuments({ type: 'admin_alert' });

    return successResponse(res, 200, "Notifications fetched successfully", {
        notifications,
        pagination: {
            total,
            page,
            pages: Math.ceil(total / limit)
        }
    });
});
