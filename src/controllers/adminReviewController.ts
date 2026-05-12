import Reviews from "../models/Reviews";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { NotFoundError } from "../utils/ApiError";

/**
 * Get all reviews
 * @route GET /api/v1/admin/reviews
 */
export const getAllReviews = asyncHandler(async (req: AdminAuthRequest, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    
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
    const review = await Reviews.findByIdAndDelete(req.params.id);
    if (!review) throw new NotFoundError("Review not found");

    // Recalculating rating logic should be handled here ideally, but for now we delete it.
    
    return successResponse(res, 200, "Review deleted successfully", null);
});
