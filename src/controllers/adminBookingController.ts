import Booking from "../models/Booking";
import Payment from "../models/Payment";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { BadRequestError, NotFoundError } from "../utils/ApiError";
import mongoose from "mongoose";

/**
 * Get all bookings
 * @route GET /api/v1/admin/bookings
 */
export const getAllBookings = asyncHandler(async (req: AdminAuthRequest, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const status = req.query.status as string;
    const workerId = req.query.workerId as string;
    const customerId = req.query.customerId as string;

    const query: any = {};
    if (status && status !== 'undefined') {
        query.status = status;
    }
    if (workerId && workerId !== 'undefined') {
        if (!mongoose.Types.ObjectId.isValid(workerId)) {
            throw new BadRequestError("Invalid workerId");
        }
        query.worker = workerId;
    }
    if (customerId && customerId !== 'undefined') {
        if (!mongoose.Types.ObjectId.isValid(customerId)) {
            throw new BadRequestError("Invalid customerId");
        }
        query.customer = customerId;
    }

    const total = await Booking.countDocuments(query);
    const bookings = await Booking.find(query)
        .populate('customer', 'fullName phone')
        .populate('worker', 'fullName phone')
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 });
    const payments = await Payment.find({ booking: { $in: bookings.map(booking => booking._id) } });
    const paymentByBooking = new Map(payments.map(payment => [payment.booking.toString(), payment.toObject()]));
    const rows = bookings.map(booking => ({
        ...booking.toObject(),
        payment: paymentByBooking.get(booking._id.toString()) || null
    }));

    return paginatedResponse(res, 200, "Bookings fetched successfully", rows, page, limit, total);
});

/**
 * Get booking details
 * @route GET /api/v1/admin/bookings/:id
 */
export const getBookingDetails = asyncHandler(async (req: AdminAuthRequest, res) => {
    const booking = await Booking.findById(req.params.id)
        .populate('customer', 'fullName phone profileImage')
        .populate('worker', 'fullName phone profileImage');

    if (!booking) throw new NotFoundError("Booking not found");

    const payment = await Payment.findOne({ booking: booking._id });

    return successResponse(res, 200, "Booking fetched successfully", {
        ...booking.toObject(),
        payment
    });
});
