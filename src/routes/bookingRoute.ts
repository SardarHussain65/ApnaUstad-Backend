import { Router } from "express";
import {
    createBooking,
    getBookingById,
    getClientHomeSummary,
    getUserBookings,
    getWorkerHomeSummary,
    getWorkerEarningsAnalytics,
    getWorkerBookings,
    updateBookingStatus,
    payBooking
} from "../controllers/bookingController";
import validate from "../middlewares/validate.middleware";
import { createBookingSchema, updateBookingStatusSchema } from "../validations/booking.validation";
import { jwtAuthMiddleware, userAuthMiddleware, workerAuthMiddleware } from "../middlewares/jwt.middleware";

const router = Router();

/**
 * @description Create a new booking
 * @access Private (User)
 */
router.route("/").post(userAuthMiddleware, validate(createBookingSchema), createBooking);

/**
 * @description Get all bookings for the authenticated user
 * @access Private (User)
 */
router.route("/my-bookings").get(userAuthMiddleware, getUserBookings);

/**
 * @description Get lightweight client home stats and recent bookings
 * @access Private (User)
 */
router.route("/home-summary").get(userAuthMiddleware, getClientHomeSummary);

/**
 * @description Get lightweight worker home stats and active bookings
 * @access Private (Worker)
 */
router.route("/worker-home-summary").get(workerAuthMiddleware, getWorkerHomeSummary);

/**
 * @description Get worker earnings analytics (daily/weekly/monthly)
 * @access Private (Worker)
 */
router.route("/worker-earnings-analytics").get(workerAuthMiddleware, getWorkerEarningsAnalytics);

/**
 * @description Get all bookings for the authenticated worker
 * @access Private (Worker)
 */
router.route("/worker-bookings").get(workerAuthMiddleware, getWorkerBookings);

/**
 * @description Get a specific booking by ID
 * @access Private (User or Worker or Admin)
 */
router.route("/:id").get(jwtAuthMiddleware, getBookingById);

/**
 * @description Update booking status
 * @access Private (User or Worker)
 */
router.route("/:id/status").patch(jwtAuthMiddleware, validate(updateBookingStatusSchema), updateBookingStatus);

/**
 * @description Mark booking as paid
 * @access Private (User)
 */
router.route("/:id/pay").post(userAuthMiddleware, payBooking);

export default router;
