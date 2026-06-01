// src/controllers/promoController.ts
import PromoCode from "../models/PromoCode";
import UserPromoUsage from "../models/UserPromoUsage";
import User from "../models/User";
import Notification from "../models/Notifications";
import { broadcastNotification } from "../services/notificationBroadcast";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { BadRequestError, NotFoundError } from "../utils/ApiError";
import { AuthRequest } from "../middlewares/jwt.middleware";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { recordAdminAction } from "../services/adminAuditLog";

/**
 * Admin: Create a new promo code template
 * @route POST /api/v1/admin/promos
 */
export const createPromoCode = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { 
        code, 
        discountType, 
        discountValue, 
        minBookingAmount = 0, 
        maxDiscountAmount = 0, 
        startDate, 
        endDate, 
        usageLimit = 0, 
        userUsageLimit = 1 
    } = req.body;

    if (!code || !discountType || discountValue === undefined || !startDate || !endDate) {
        throw new BadRequestError("Code, discount type, value, start date, and end date are required");
    }

    const uppercaseCode = code.trim().toUpperCase();

    // Check if code already exists
    const existing = await PromoCode.findOne({ code: uppercaseCode });
    if (existing) {
        throw new BadRequestError(`Promo code '${uppercaseCode}' already exists`);
    }

    const promo = await PromoCode.create({
        code: uppercaseCode,
        discountType,
        discountValue,
        minBookingAmount,
        maxDiscountAmount,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        usageLimit,
        userUsageLimit
    });

    // Record system audit log
    await recordAdminAction(req, {
        action: 'promo.create',
        entityType: 'promo',
        entityId: promo._id.toString(),
        reason: `Created promo code ${uppercaseCode}`,
        metadata: {
            code: uppercaseCode,
            discountType,
            discountValue
        }
    });

    // Trigger Automated Marketing Broadcast or Scheduled Notification
    try {
        const now = new Date();
        const start = new Date(startDate);
        const end = new Date(endDate);

        const rulesDescription = discountType === 'percentage'
            ? `${discountValue}% Off on your booking!`
            : `Rs. ${discountValue} Flat Discount!`;

        if (start <= now && end > now) {
            // Immediate Broadcast to all active users
            await broadcastNotification({
                target: 'users',
                title: `🎉 Discount Code: ${uppercaseCode}!`,
                body: `Use code ${uppercaseCode} now to get ${rulesDescription} Minimum booking Rs. ${minBookingAmount}. Book your ApnaUstad today!`,
                type: 'general'
            });
        } else if (start > now) {
            // Future Scheduled Broadcast: Create created status notifications for all active users
            const users = await User.find({ isActive: true }, { _id: 1 }).lean();
            if (users.length > 0) {
                const docs = users.map(u => ({
                    recipient: u._id,
                    recipientType: 'user',
                    title: `🎉 Upcoming Offer: ${uppercaseCode}!`,
                    message: `Get ready! Promo code ${uppercaseCode} goes live on ${start.toLocaleDateString()} for ${rulesDescription}. Minimum booking Rs. ${minBookingAmount}.`,
                    type: 'general',
                    isRead: false,
                    deliveryStatus: 'created',
                    scheduledAt: start
                }));
                await Notification.insertMany(docs);
            }
        }
    } catch (notificationError) {
        // Log notification scheduler issues but do not fail the API response
        console.error("⚠️ Automated marketing campaign hook error:", notificationError);
    }

    return successResponse(res, 201, "Promo code created successfully", promo);
});

/**
 * Admin: Get all promo codes with pagination
 * @route GET /api/v1/admin/promos
 */
export const getAllPromoCodes = asyncHandler(async (req: AdminAuthRequest, res) => {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const skip = (page - 1) * limit;

    const total = await PromoCode.countDocuments({});
    const promos = await PromoCode.find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    return paginatedResponse(res, 200, "Promo codes fetched successfully", promos, page, limit, total);
});

/**
 * Admin: Toggle active status of a promo code
 * @route PATCH /api/v1/admin/promos/:id/status
 */
export const togglePromoCode = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;

    const promo = await PromoCode.findById(id);
    if (!promo) {
        throw new NotFoundError("Promo code not found");
    }

    promo.isActive = !promo.isActive;
    await promo.save();

    // Record system audit log
    await recordAdminAction(req, {
        action: promo.isActive ? 'promo.activate' : 'promo.deactivate',
        entityType: 'promo',
        entityId: promo._id.toString(),
        reason: `Toggled status of promo code ${promo.code} to ${promo.isActive ? 'active' : 'inactive'}`,
        metadata: {
            code: promo.code,
            isActive: promo.isActive
        }
    });

    return successResponse(res, 200, `Promo code is now ${promo.isActive ? 'active' : 'inactive'}`, promo);
});

/**
 * Admin: Delete a promo code template
 * @route DELETE /api/v1/admin/promos/:id
 */
export const deletePromoCode = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;

    const promo = await PromoCode.findByIdAndDelete(id);
    if (!promo) {
        throw new NotFoundError("Promo code not found");
    }

    // Record system audit log
    await recordAdminAction(req, {
        action: 'promo.delete',
        entityType: 'promo',
        entityId: id as string,
        reason: `Deleted promo code ${promo.code}`,
        metadata: {
            code: promo.code
        }
    });

    return successResponse(res, 200, "Promo code deleted successfully", null);
});

/**
 * Mobile Client: Validate a promo code
 * @route POST /api/v1/promos/validate
 */
export const validatePromoCode = asyncHandler(async (req: AuthRequest, res) => {
    const { code, bookingAmount } = req.body;
    const userId = req.tokenPayload?.id;

    if (!code || bookingAmount === undefined) {
        throw new BadRequestError("Promo code and booking amount are required");
    }

    const uppercaseCode = code.trim().toUpperCase();
    const promo = await PromoCode.findOne({ code: uppercaseCode });

    if (!promo) {
        return res.status(200).json({
            success: true,
            data: { isValid: false, message: "Invalid promo code" }
        });
    }

    if (!promo.isActive) {
        return res.status(200).json({
            success: true,
            data: { isValid: false, message: "This promo code is no longer active" }
        });
    }

    const now = new Date();
    if (now < promo.startDate) {
        return res.status(200).json({
            success: true,
            data: { isValid: false, message: "This promo code has not started yet" }
        });
    }

    if (now > promo.endDate) {
        return res.status(200).json({
            success: true,
            data: { isValid: false, message: "This promo code has expired" }
        });
    }

    if (bookingAmount < promo.minBookingAmount) {
        return res.status(200).json({
            success: true,
            data: {
                isValid: false,
                message: `Minimum booking amount to use this code is ${promo.minBookingAmount}`
            }
        });
    }

    if (promo.usageLimit > 0 && promo.usageCount >= promo.usageLimit) {
        return res.status(200).json({
            success: true,
            data: { isValid: false, message: "This promo code global limit has been reached" }
        });
    }

    // Check user usage limit
    if (userId) {
        const userUsage = await UserPromoUsage.countDocuments({
            user: userId,
            promoCode: promo._id
        });

        if (userUsage >= promo.userUsageLimit) {
            return res.status(200).json({
                success: true,
                data: { isValid: false, message: "You have exceeded the usage limit for this promo code" }
            });
        }
    }

    // Calculate discount amount
    let discountAmount = 0;
    if (promo.discountType === 'fixed') {
        discountAmount = promo.discountValue;
    } else {
        discountAmount = (bookingAmount * promo.discountValue) / 100;
        if (promo.maxDiscountAmount > 0 && discountAmount > promo.maxDiscountAmount) {
            discountAmount = promo.maxDiscountAmount;
        }
    }

    // Safeguard discount exceeding booking amount
    discountAmount = Math.min(discountAmount, bookingAmount);
    const finalAmount = bookingAmount - discountAmount;

    return successResponse(res, 200, "Promo code validated successfully", {
        isValid: true,
        discountType: promo.discountType,
        discountValue: promo.discountValue,
        discountAmount,
        finalAmount,
        message: "Promo code applied successfully!"
    });
});
