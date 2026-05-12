import Notifications from "../models/Notifications";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";

/**
 * Send global notification to users or workers
 * @route POST /api/v1/admin/notifications/global
 */
export const sendGlobalNotification = asyncHandler(async (_req: AdminAuthRequest, res) => {
    // This endpoint must not report success until notification persistence and/or
    // background delivery has actually been implemented.
    return res.status(501).json({
        success: false,
        message: "Global notification sending is not implemented yet. No notification was queued or persisted."
    });
});

/**
 * Get recent system notifications
 * @route GET /api/v1/admin/notifications
 */
export const getAdminNotifications = asyncHandler(async (req: AdminAuthRequest, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

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
});
