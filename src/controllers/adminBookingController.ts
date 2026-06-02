import Booking from "../models/Booking";
import Payment from "../models/Payment";
import JobPost from "../models/JobPost";
import User from "../models/User";
import Worker from "../models/Workers";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { BadRequestError, NotFoundError } from "../utils/ApiError";
import mongoose from "mongoose";
import { syncPaymentForBookingStatus } from "../services/paymentLedgerService";
import { releaseCommissionReservation } from "../services/commissionReservationService";
import { getIO } from "../sockets/socketManager";
import { emitBookingEvent } from "../sockets/handlers/booking.handler";

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Get all bookings
 * @route GET /api/v1/admin/bookings
 */
export const getAllBookings = asyncHandler(async (req: AdminAuthRequest, res) => {
    const parsedPage = parseInt(req.query.page as string, 10);
    const parsedLimit = parseInt(req.query.limit as string, 10);
    const page = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
    const limit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 10 : Math.min(parsedLimit, 200);
    const status = req.query.status as string;
    const workerId = req.query.workerId as string;
    const customerId = req.query.customerId as string;
    const search = req.query.search as string;
    const paymentStatus = req.query.paymentStatus as string;
    const bookingType = req.query.bookingType as string;
    const dateFrom = req.query.dateFrom as string;
    const dateTo = req.query.dateTo as string;

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
    if (bookingType && bookingType !== 'undefined') {
        query.bookingType = bookingType;
    }
    if (dateFrom || dateTo) {
        query.scheduledDate = {};
        if (dateFrom) {
            const parsedDateFrom = new Date(dateFrom);
            if (Number.isNaN(parsedDateFrom.getTime())) {
                throw new BadRequestError("Invalid dateFrom");
            }
            query.scheduledDate.$gte = parsedDateFrom;
        }
        if (dateTo) {
            const parsedDateTo = new Date(dateTo);
            if (Number.isNaN(parsedDateTo.getTime())) {
                throw new BadRequestError("Invalid dateTo");
            }
            parsedDateTo.setHours(23, 59, 59, 999);
            query.scheduledDate.$lte = parsedDateTo;
        }
    }
    if (paymentStatus && paymentStatus !== 'undefined') {
        const bookingIds = await Payment.find({ status: paymentStatus }).distinct('booking');
        query._id = { $in: bookingIds };
    }
    if (search) {
        const searchRegex = new RegExp(escapeRegex(search), 'i');
        const [customers, workers] = await Promise.all([
            User.find({ $or: [{ fullName: searchRegex }, { phone: searchRegex }] }).select('_id'),
            Worker.find({ $or: [{ fullName: searchRegex }, { phone: searchRegex }] }).select('_id')
        ]);
        const searchQuery: any[] = [
            { category: searchRegex },
            { description: searchRegex },
            { customer: { $in: customers.map(customer => customer._id) } },
            { worker: { $in: workers.map(worker => worker._id) } }
        ];
        if (mongoose.Types.ObjectId.isValid(search)) {
            searchQuery.push({ _id: new mongoose.Types.ObjectId(search) });
        }
        query.$and = [...(query.$and || []), { $or: searchQuery }];
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

/**
 * Force update booking status (admin override)
 * @route PATCH /api/v1/admin/bookings/:id/status
 */
export const updateBookingStatus = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { status: nextStatus, cancelReason } = req.body;

    if (!nextStatus) {
        throw new BadRequestError("Status is required");
    }

    const validStatuses = ['pending', 'accepted', 'ongoing', 'completed', 'cancelled'];
    if (!validStatuses.includes(nextStatus)) {
        throw new BadRequestError(`Invalid status: ${nextStatus}`);
    }

    const booking = await Booking.findById(id);
    if (!booking) {
        throw new NotFoundError("Booking not found");
    }

    booking.status = nextStatus;

    if (nextStatus === 'cancelled') {
        booking.cancelledBy = 'admin';
        booking.cancelReason = cancelReason || 'Admin force cancel';
    }

    await booking.save();

    // Release commission reservation if transitioned to cancelled
    if (nextStatus === 'cancelled') {
        await releaseCommissionReservation(booking._id).catch(err => {});
    }

    // Sync payments and linked job posts
    await syncPaymentForBookingStatus(booking).catch(err => {});
    
    if (booking.jobPost) {
        const linkedStatus = nextStatus === 'completed'
            ? 'closed'
            : nextStatus === 'cancelled'
                ? 'cancelled'
                : null;
        if (linkedStatus) {
            await JobPost.findByIdAndUpdate(booking.jobPost, { $set: { status: linkedStatus } }).catch(err => {});
        }
    }

    // Emit socket event to notify other parties
    try {
        const io = getIO();
        emitBookingEvent(io, booking, nextStatus === 'cancelled' ? 'booking:cancelled' : `booking:${nextStatus}`);
    } catch (err) {}

    return successResponse(res, 200, `Booking status force updated to ${nextStatus}`, booking);
});

/**
 * Cancel booking (admin override)
 * @route POST /api/v1/admin/bookings/:id/cancel
 */
export const cancelBooking = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    const booking = await Booking.findById(id);
    if (!booking) {
        throw new NotFoundError("Booking not found");
    }

    if (booking.status === 'completed' || booking.status === 'cancelled') {
        throw new BadRequestError(`Booking is already in a terminal state: ${booking.status}`);
    }

    booking.status = 'cancelled';
    booking.cancelledBy = 'admin';
    booking.cancelReason = reason || 'Admin cancelled';
    await booking.save();

    await releaseCommissionReservation(booking._id).catch(err => {});
    await syncPaymentForBookingStatus(booking).catch(err => {});

    if (booking.jobPost) {
        await JobPost.findByIdAndUpdate(booking.jobPost, { $set: { status: 'cancelled' } }).catch(err => {});
    }

    // Emit socket event
    try {
        const io = getIO();
        emitBookingEvent(io, booking, 'booking:cancelled');
    } catch (err) {}

    return successResponse(res, 200, "Booking cancelled successfully by Admin override", booking);
});
