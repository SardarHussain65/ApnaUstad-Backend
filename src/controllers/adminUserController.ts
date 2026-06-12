import User from "../models/User";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../utils/ApiError";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { recordAdminAction } from "../services/adminAuditLog";

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Get all users for admin management
 * @route GET /api/v1/admin/users
 */
export const getAllUsers = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { status, search, city, dateFrom, page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 10, 200);
    const skip = (pageNum - 1) * limitNum;

    let query: any = {};
    if (status !== undefined) {
        query.isActive = status === 'active';
    }
    
    if (search) {
        const searchRegex = new RegExp(escapeRegex(search as string), 'i');
        query.$or = [
            { fullName: searchRegex },
            { email: searchRegex },
            { phone: searchRegex }
        ];
    }
    
    if (city) {
        query.city = new RegExp(escapeRegex(city as string), 'i');
    }

    if (dateFrom) {
        const joinedAfter = new Date(dateFrom as string);
        if (Number.isNaN(joinedAfter.getTime())) {
            throw new BadRequestError("Invalid dateFrom");
        }
        query.createdAt = { $gte: joinedAfter };
    }

    // Admins get to see everything for analysis
    const total = await User.countDocuments(query);
    const users = await User.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum);

    return paginatedResponse(res, 200, "Users fetched successfully", users, pageNum, limitNum, total);
});

/**
 * Get single user details for admin
 * @route GET /api/v1/admin/users/:id
 */
export const getUserDetails = asyncHandler(async (req: AdminAuthRequest, res) => {
    const user = await User.findById(req.params.id).populate("favorites", "-password -fcmToken -cnicNumber -cnicFrontImage -cnicBackImage -location -address -phone -email");
    if (!user) {
        throw new NotFoundError("User not found");
    }
    return successResponse(res, 200, "User details fetched successfully", user);
});

/**
 * Activate / Deactivate a user
 * @route PATCH /api/v1/admin/users/:id/status
 */
export const toggleUserStatus = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { isActive } = req.body;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

    if (reason.length > 500) {
        throw new BadRequestError("Reason is too long");
    }

    if (isActive === undefined) {
        throw new BadRequestError("isActive field is required");
    }
    if (isActive === false && !reason) {
        throw new BadRequestError("Deactivation reason is required");
    }

    const user = await User.findByIdAndUpdate(
        id,
        isActive
            ? {
                isActive: true,
                deactivationReason: '',
                reactivatedAt: new Date(),
                reactivatedBy: req.admin?._id || null,
            }
            : {
                isActive: false,
                deactivationReason: reason,
                deactivatedAt: new Date(),
                deactivatedBy: req.admin?._id || null,
            },
        { new: true, runValidators: true }
    );

    if (!user) {
        throw new NotFoundError("User not found");
    }

    await recordAdminAction(req, {
        action: isActive ? 'user.activate' : 'user.deactivate',
        entityType: 'user',
        entityId: user._id.toString(),
        reason,
        metadata: {
            fullName: user.fullName,
            phone: user.phone,
            email: user.email,
            isActive: user.isActive,
            deactivationReason: user.deactivationReason || ''
        }
    });

    const message = isActive ? "User activated successfully" : "User deactivated successfully";
    return successResponse(res, 200, message, user);
});
