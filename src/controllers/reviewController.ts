import { Request, Response } from "express";
import { AuthRequest } from "../middlewares/jwt.middleware";
import Review from "../models/Reviews";
import Booking from "../models/Booking";

/**
 * @description Create a new review
 * @route POST /api/v1/reviews
 * @access Private (User)
 */
export const createReview = async (req: AuthRequest, res: Response) => {
    try {
        const customerId = req.tokenPayload?.id;
        if (!customerId) {
            res.status(401).json({ success: false, message: "Unauthorized" });
            return;
        }

        const { booking: bookingId, worker, rating, comment } = req.body;

        // Verify booking
        const booking = await Booking.findById(bookingId);
        if (!booking) {
            res.status(404).json({ success: false, message: "Booking not found" });
            return;
        }

        if (booking.customer.toString() !== customerId) {
            res.status(403).json({ success: false, message: "Forbidden: You do not own this booking" });
            return;
        }

        if (booking.status !== 'completed') {
            res.status(400).json({ success: false, message: "Can only review completed bookings" });
            return;
        }

        if (booking.isReviewed) {
            res.status(400).json({ success: false, message: "Booking has already been reviewed" });
            return;
        }

        // Create review
        const review = await Review.create({
            booking: bookingId,
            customer: customerId,
            worker,
            rating,
            comment
        });

        // Update booking
        booking.isReviewed = true;
        await booking.save();

        res.status(201).json({
            success: true,
            message: "Review submitted successfully",
            data: review
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @description Get all reviews for a specific worker
 * @route GET /api/v1/reviews/worker/:workerId
 * @access Public
 */
export const getWorkerReviews = async (req: Request, res: Response) => {
    try {
        const { workerId } = req.params;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;

        const reviews = await Review.find({ worker: workerId })
            .populate('customer', 'fullName profileImage')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Review.countDocuments({ worker: workerId });

        res.status(200).json({
            success: true,
            data: reviews,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
