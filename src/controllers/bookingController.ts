import { Response } from "express";
import { AuthRequest } from "../middlewares/jwt.middleware";
import Booking from "../models/Booking";
import Worker from "../models/Workers";
import { getConfig } from "../config/env";
import logger from "../config/logger";

/**
 * @description Create a new booking
 * @route POST /api/v1/bookings
 * @access Private (User)
 */
export const createBooking = async (req: AuthRequest, res: Response) => {
    try {
        const customerId = req.tokenPayload?.id;
        if (!customerId) {
            res.status(401).json({ success: false, message: "Unauthorized" });
            return;
        }

        const {
            worker: workerId, category, description,
            estimatedHours, address, longitude, latitude,
            bookingType = 'scheduled'
        } = req.body;

        let { scheduledDate, scheduledTime } = req.body;

        if (bookingType === 'instant') {
            const now = new Date();
            scheduledDate = now;
            scheduledTime = now.toTimeString().split(' ')[0]?.substring(0, 5) || "00:00";
        } else {
            if (!scheduledDate || !scheduledTime) {
                res.status(400).json({ success: false, message: "Scheduled date and time are required for scheduled bookings" });
                return;
            }
        }

        // Fetch authoritative worker data
        const workerProfile = await Worker.findById(workerId);
        if (!workerProfile) {
            res.status(404).json({ success: false, message: "Worker not found" });
            return;
        }

        if (bookingType === 'instant') {
            const busy = await Booking.findOne({
                worker: workerId,
                status: { $in: ['accepted', 'ongoing'] }
            });
            if (busy) {
                res.status(409).json({ success: false, message: "Worker is currently busy" });
                return;
            }
        }

        const config = getConfig();
        const hourlyRate = workerProfile.hourlyRate;
        const subtotal = estimatedHours * hourlyRate;
        const platformFeePercentage = config.platformFeePercentage || 10;
        const platformFee = Math.round((subtotal * (platformFeePercentage / 100)) * 100) / 100;
        const totalAmount = subtotal + platformFee;
        const workerEarning = subtotal - platformFee;

        const location = (longitude !== undefined && latitude !== undefined) ? {
            type: "Point",
            coordinates: [longitude, latitude]
        } : undefined;

        const expiresAt = bookingType === 'instant'
            ? new Date(Date.now() + 2 * 60 * 1000)
            : new Date(Date.now() + 24 * 60 * 60 * 1000);

        const booking = await Booking.create({
            customer: customerId,
            worker: workerId,
            category,
            description,
            scheduledDate,
            scheduledTime,
            estimatedHours,
            hourlyRate,
            subtotal,
            platformFee,
            totalAmount,
            workerEarning,
            address,
            bookingType,
            expiresAt,
            ...(location && { location })
        });

        // Emit socket event to the worker
        const io = require('../sockets/socketManager').getIO();
        const { emitBookingEvent } = require('../sockets/handlers/booking.handler');
        const eventPayload = bookingType === 'instant' 
            ? { ...booking.toObject(), urgent: true } 
            : booking;
        emitBookingEvent(io, eventPayload, 'booking:new');

        res.status(201).json({
            success: true,
            message: "Booking created successfully",
            data: booking
        });
    } catch (error: any) {
        logger.error("Error in createBooking:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get booking by ID
 * @route GET /api/v1/bookings/:id
 * @access Private (Generic Auth)
 */
export const getBookingById = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.tokenPayload?.id;
        const userType = req.tokenPayload?.type;

        // Load booking without population first to check ownership
        const booking = await Booking.findById(id);

        if (!booking) {
            res.status(404).json({ success: false, message: "Booking not found" });
            return;
        }

        // Authorization Check: Only customer, worker, or admin can access
        if (!isAuthorizedForBooking(booking, req.tokenPayload)) {
            res.status(403).json({ success: false, message: "Forbidden: You are not authorized to view this booking" });
            return;
        }

        // If authorized, populate sensitive fields
        await booking.populate([
            { path: 'customer', select: 'fullName email phone profileImage' },
            { path: 'worker', select: 'fullName email phone profileImage category averageRating' }
        ]);

        res.status(200).json({
            success: true,
            data: booking
        });
    } catch (error: any) {
        logger.error("Error in getBookingById:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get all bookings for the authenticated user
 * @route GET /api/v1/bookings/my-bookings (Users)
 * @access Private (User)
 */
export const getUserBookings = async (req: AuthRequest, res: Response) => {
    try {
        const customerId = req.tokenPayload?.id;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;

        const bookings = await Booking.find({ customer: customerId })
            .populate('worker', 'fullName profileImage category')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Booking.countDocuments({ customer: customerId });

        res.status(200).json({
            success: true,
            data: bookings,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error: any) {
        logger.error("Error in getUserBookings:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get all bookings for the authenticated worker
 * @route GET /api/v1/bookings/worker-bookings (Workers)
 * @access Private (Worker)
 */
export const getWorkerBookings = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;

        const bookings = await Booking.find({ worker: workerId })
            .populate('customer', 'fullName profileImage address')
            .sort({ scheduledDate: 1 }) // Sorted by nearest scheduled date
            .skip(skip)
            .limit(limit);

        const total = await Booking.countDocuments({ worker: workerId });

        res.status(200).json({
            success: true,
            data: bookings,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error: any) {
        logger.error("Error in getWorkerBookings:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Update booking status
 * @route PATCH /api/v1/bookings/:id/status
 * @access Private (Generic Auth)
 */
export const updateBookingStatus = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { status: nextStatus, cancelReason } = req.body;
        const userId = req.tokenPayload?.id;
        const userType = req.tokenPayload?.type; // 'user', 'worker', or 'admin'

        const booking = await Booking.findById(id);

        if (!booking) {
            res.status(404).json({ success: false, message: "Booking not found" });
            return;
        }

        // Verify ownership (Only the involved customer, worker, or an admin can update it)
        const isWorker = booking.worker.toString() === userId;
        const isAdmin = userType === 'admin' || req.tokenPayload?.role === 'admin' || req.tokenPayload?.role === 'superadmin';

        if (!isAuthorizedForBooking(booking, req.tokenPayload)) {
            res.status(403).json({ success: false, message: "Forbidden: You are not authorized to update this booking" });
            return;
        }

        const currentStatus = booking.status;

        // 1. Prevent updates to terminal states
        if (currentStatus === 'completed' || currentStatus === 'cancelled') {
            res.status(400).json({ success: false, message: `Cannot update booking from terminal state: ${currentStatus}` });
            return;
        }

        // 2. Define allowed transitions and role permissions
        let isTransitionAllowed = false;

        if (isAdmin) {
            isTransitionAllowed = true; // Admin can perform any transition for now
        } else {
            switch (nextStatus) {
                case 'accepted':
                    // Only worker can accept from pending
                    if (currentStatus === 'pending' && isWorker) isTransitionAllowed = true;
                    break;
                case 'ongoing':
                    // Only worker can start from accepted
                    if (currentStatus === 'accepted' && isWorker) isTransitionAllowed = true;
                    break;
                case 'completed':
                    // Only worker can complete from ongoing
                    if (currentStatus === 'ongoing' && isWorker) isTransitionAllowed = true;
                    break;
                case 'cancelled':
                    // Both can cancel if not already completed/cancelled
                    isTransitionAllowed = true;
                    break;
                default:
                    isTransitionAllowed = false;
            }
        }

        if (!isTransitionAllowed) {
            res.status(400).json({
                success: false,
                message: `Invalid transition from ${currentStatus} to ${nextStatus} for role ${userType}`
            });
            return;
        }

        // Apply new values
        booking.status = nextStatus;

        if (nextStatus === 'accepted' || nextStatus === 'cancelled') {
            booking.workerRespondedAt = new Date();
        }

        if (nextStatus === 'cancelled') {
            booking.cancelledBy = userType === 'user' ? 'customer' : (userType as 'worker' | 'admin');
            booking.cancelReason = cancelReason || '';
        }

        await booking.save();

        // Emit socket event
        const io = require('../sockets/socketManager').getIO();
        const { emitBookingEvent } = require('../sockets/handlers/booking.handler');
        emitBookingEvent(io, booking, nextStatus === 'cancelled' ? 'booking:cancelled' : `booking:${nextStatus}`);

        res.status(200).json({
            success: true,
            message: `Booking status updated to ${nextStatus}`,
            data: booking
        });
    } catch (error: any) {
        logger.error("Error in updateBookingStatus:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * Helper to check if a user is authorized to view/update a booking
 * @param booking Booking document
 * @param tokenPayload Decoded JWT payload
 * @returns boolean
 */
const isAuthorizedForBooking = (booking: any, tokenPayload: any): boolean => {
    const userId = tokenPayload?.id;
    const userType = tokenPayload?.type;
    const userRole = tokenPayload?.role;

    const isCustomer = booking.customer.toString() === userId;
    const isWorker = booking.worker.toString() === userId;
    const isAdmin = userType === 'admin' || userRole === 'admin' || userRole === 'superadmin';

    return isCustomer || isWorker || isAdmin;
};
