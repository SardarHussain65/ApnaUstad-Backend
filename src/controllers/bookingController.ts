import { Response } from "express";
import { AuthRequest } from "../middlewares/jwt.middleware";
import Booking from "../models/Booking";

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
            worker, category, description, scheduledDate, scheduledTime,
            estimatedHours, hourlyRate, subtotal, platformFee, totalAmount,
            workerEarning, address, longitude, latitude
        } = req.body;

        const location = (longitude !== undefined && latitude !== undefined) ? {
            type: "Point",
            coordinates: [longitude, latitude]
        } : undefined;

        const booking = await Booking.create({
            customer: customerId,
            worker,
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
            ...(location && { location })
        });

        res.status(201).json({
            success: true,
            message: "Booking created successfully",
            data: booking
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
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
        const booking = await Booking.findById(id)
            .populate('customer', 'fullName email phone profileImage')
            .populate('worker', 'fullName email phone profileImage category averageRating');

        if (!booking) {
            res.status(404).json({ success: false, message: "Booking not found" });
            return;
        }

        res.status(200).json({
            success: true,
            data: booking
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
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
        res.status(500).json({ success: false, message: error.message });
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
        res.status(500).json({ success: false, message: error.message });
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
        const { status, cancelReason } = req.body;
        const userId = req.tokenPayload?.id;
        const userType = req.tokenPayload?.type; // 'user' or 'worker'

        const booking = await Booking.findById(id);

        if (!booking) {
             res.status(404).json({ success: false, message: "Booking not found" });
             return;
        }

        // Verify ownership (Only the involved customer or worker can update it)
        if (booking.customer.toString() !== userId && booking.worker.toString() !== userId) {
            res.status(403).json({ success: false, message: "Forbidden: You are not authorized to update this booking" });
            return;
        }

        // Apply new values
        booking.status = status;
        
        if (status === 'cancelled') {
            booking.cancelledBy = userType as 'customer' | 'worker';
            booking.cancelReason = cancelReason || '';
        }

        await booking.save();

        res.status(200).json({
            success: true,
            message: `Booking status updated to ${status}`,
            data: booking
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
