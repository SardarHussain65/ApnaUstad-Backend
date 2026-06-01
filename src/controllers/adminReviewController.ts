import Reviews from "../models/Reviews";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { NotFoundError } from "../utils/ApiError";
import Worker from "../models/Workers";
import { recordAdminAction } from "../services/adminAuditLog";

/**
 * Get all reviews
 * @route GET /api/v1/admin/reviews
 */
export const getAllReviews = asyncHandler(async (req: AdminAuthRequest, res) => {
    const parsedPage = parseInt(req.query.page as string, 10);
    const parsedLimit = parseInt(req.query.limit as string, 10);
    const page = Number.isNaN(parsedPage) ? 1 : Math.max(parsedPage, 1);
    const limit = Number.isNaN(parsedLimit) ? 10 : Math.min(Math.max(parsedLimit, 1), 100);
    
    const total = await Reviews.countDocuments();
    const reviews = await Reviews.find()
        .populate('customer', 'fullName phone profileImage')
        .populate('worker', 'fullName phone profileImage')
        .populate('booking')
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 });

    return paginatedResponse(res, 200, "Reviews fetched successfully", reviews, page, limit, total);
});

/**
 * Delete a review
 * @route DELETE /api/v1/admin/reviews/:id
 */
export const deleteReview = asyncHandler(async (req: AdminAuthRequest, res) => {
    const reason = typeof req.body?.reason === 'string'
        ? req.body.reason.trim()
        : typeof req.query?.reason === 'string'
            ? String(req.query.reason).trim()
            : '';

    const review = await Reviews.findByIdAndDelete(req.params.id);
    if (!review) throw new NotFoundError("Review not found");

    await recordAdminAction(req, {
        action: 'review.delete',
        entityType: 'review',
        entityId: review._id.toString(),
        reason,
        metadata: {
            booking: review.booking?.toString(),
            worker: review.worker?.toString(),
            customer: review.customer?.toString(),
            rating: review.rating
        }
    });

    const stats = await Reviews.aggregate([
        { $match: { worker: review.worker } },
        { $group: { _id: '$worker', avgRating: { $avg: '$rating' }, totalReviews: { $sum: 1 } } }
    ]);

    if (stats.length > 0) {
        await Worker.findByIdAndUpdate(review.worker, {
            rating: Math.round(stats[0].avgRating * 10) / 10,
            totalReviews: stats[0].totalReviews
        });
    } else {
        await Worker.findByIdAndUpdate(review.worker, { rating: 0, totalReviews: 0 });
    }

    return successResponse(res, 200, "Review deleted successfully", null);
});

/**
 * Flag / Toggle Flag status of a review
 * @route PATCH /api/v1/admin/reviews/:id/flag
 */
export const toggleFlagReview = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    const review = await Reviews.findById(id);
    if (!review) throw new NotFoundError("Review not found");

    review.isFlagged = !review.isFlagged;
    await review.save();

    await recordAdminAction(req, {
        action: review.isFlagged ? 'review.flag' : 'review.unflag',
        entityType: 'review',
        entityId: review._id.toString(),
        reason: reason || (review.isFlagged ? 'Review flagged by admin' : 'Review unflagged by admin'),
        metadata: {
            booking: review.booking?.toString(),
            worker: review.worker?.toString(),
            customer: review.customer?.toString(),
            rating: review.rating
        }
    });

    return successResponse(res, 200, `Review ${review.isFlagged ? 'flagged' : 'unflagged'} successfully`, review);
});
