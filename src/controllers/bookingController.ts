import { Response } from "express";
import mongoose, { Types } from "mongoose";
import { AuthRequest } from "../middlewares/jwt.middleware";
import Booking from "../models/Booking";
import JobPost from "../models/JobPost";
import Worker from "../models/Workers";
import logger from "../config/logger";
import { confirmCashPaymentForBooking, syncPaymentForBookingStatus } from "../services/paymentLedgerService";
import { sendNotificationToRecipient } from "../services/notificationHelper";
import { buildInsufficientBalanceMessage, calculateCommissionAmount, getWalletEligibility } from "../services/workerWalletService";
import { workerAcceptsJobType } from "../services/workerJobAvailabilityService";
import { releaseCommissionReservation, reserveCommission } from "../services/commissionReservationService";
import { getWalletSettings } from "../services/walletSettingsService";
import { getIO } from "../sockets/socketManager";
import { emitBookingEvent } from "../sockets/handlers/booking.handler";

const toPlainObject = (doc: any) => doc?.toObject ? doc.toObject() : doc;

const syncLinkedJobPostStatus = async (booking: any) => {
    if (!booking.jobPost) return;

    const linkedStatus = booking.status === 'completed'
        ? 'closed'
        : booking.status === 'cancelled'
            ? 'cancelled'
            : null;

    if (linkedStatus) {
        await JobPost.findByIdAndUpdate(booking.jobPost, { $set: { status: linkedStatus } });
    }
};

const DEFAULT_BOOKING_STATUS_META = { label: 'Pending', tone: 'warning', accentColor: '#FFD700', actionLabel: 'Track request' };

const BOOKING_STATUS_META: Record<string, { label: string; tone: string; accentColor: string; actionLabel: string }> = {
    pending: DEFAULT_BOOKING_STATUS_META,
    accepted: { label: 'Accepted', tone: 'info', accentColor: '#00F5FF', actionLabel: 'Track booking' },
    ongoing: { label: 'In progress', tone: 'info', accentColor: '#BF5AF2', actionLabel: 'Open live job' },
    completed: { label: 'Completed', tone: 'success', accentColor: '#34C759', actionLabel: 'View receipt' },
    cancelled: { label: 'Cancelled', tone: 'danger', accentColor: '#FF3B30', actionLabel: 'View details' },
};

const formatDisplayDate = (date?: Date | string) => {
    const parsedDate = date ? new Date(date) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
        return {
            dateLabel: 'Today',
            dayLabel: '',
            fullDateLabel: 'Today',
        };
    }

    return {
        dateLabel: parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        dayLabel: parsedDate.toLocaleDateString('en-US', { weekday: 'short' }),
        fullDateLabel: parsedDate.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }),
    };
};

const buildBookingCardPayload = (bookingDoc: any, viewerRole: 'user' | 'worker') => {
    const booking = toPlainObject(bookingDoc);
    const person = viewerRole === 'worker' ? booking.customer : booking.worker;
    const isCommunicationLocked = booking.status === 'completed' || booking.status === 'cancelled';
    const sanitizePerson = (profile: any) => {
        if (!profile || typeof profile !== 'object') return profile;
        return {
            ...profile,
            phone: isCommunicationLocked ? '' : profile.phone || '',
            email: isCommunicationLocked ? '' : profile.email || '',
        };
    };
    const roleLabel = viewerRole === 'worker' ? 'Client' : 'Ustad';
    const amount = viewerRole === 'worker'
        ? Number(booking.agreement?.workerNetIncome ?? booking.workerEarning ?? 0)
        : Number(booking.agreement?.cashDue ?? booking.totalAmount ?? 0);
    const statusMeta = BOOKING_STATUS_META[booking.status] || DEFAULT_BOOKING_STATUS_META;
    const dateMeta = formatDisplayDate(booking.scheduledDate);
    const missionKindLabel = booking.bookingType === 'instant' ? 'Instant visit' : 'Scheduled visit';
    const mediaImages = Array.isArray(booking.imageUrls) ? booking.imageUrls : [];
    const mediaVideos = Array.isArray(booking.videoUrls) ? booking.videoUrls : [];
    const mediaAudios = Array.isArray(booking.audioUrls) ? booking.audioUrls : [];

    return {
        ...booking,
        customer: sanitizePerson(booking.customer),
        worker: sanitizePerson(booking.worker),
        cardMeta: {
            source: 'booking',
            title: booking.category,
            description: booking.description,
            missionKind: booking.bookingType,
            missionKindLabel,
            primaryImageUrl: person?.profileImage || mediaImages[0] || '',
            media: {
                images: mediaImages,
                videos: mediaVideos,
                audios: mediaAudios,
                coverUrl: mediaImages[0] || '',
                totalCount: mediaImages.length + mediaVideos.length + mediaAudios.length,
            },
            statusInfo: {
                value: booking.status,
                ...statusMeta,
            },
            schedule: {
                ...dateMeta,
                timeLabel: booking.scheduledTime || 'ASAP',
            },
            location: {
                address: booking.address || '',
            },
            actionLabel: statusMeta.actionLabel,
            counterParty: person ? {
                _id: person._id,
                fullName: person.fullName,
                phone: isCommunicationLocked ? '' : person.phone || '',
                email: isCommunicationLocked ? '' : person.email || '',
                profileImage: person.profileImage || '',
                roleLabel,
                category: person.category || '',
                address: person.address || '',
                city: person.city || '',
                rating: Number(person.rating || 0),
                totalReviews: Number(person.totalReviews || 0),
                totalJobs: Number(person.totalJobs || 0),
                hourlyRate: Number(person.hourlyRate || 0),
                experience: Number(person.experience || 0),
                isVerified: Boolean(person.isVerified),
                isAvailable: person.isAvailable !== undefined ? Boolean(person.isAvailable) : undefined,
                isActive: person.isActive !== undefined ? Boolean(person.isActive) : undefined,
                joinedAt: person.createdAt || '',
            } : {
                fullName: 'Searching...',
                profileImage: '',
                roleLabel,
            },
            financial: {
                label: viewerRole === 'worker' ? 'Earning' : 'Total',
                amount,
                cashDue: Number(booking.agreement?.cashDue ?? booking.totalAmount ?? 0),
                agreedPrice: Number(booking.agreement?.agreedPrice ?? booking.subtotal ?? 0),
                subtotal: Number(booking.subtotal || 0),
                platformFee: Number(booking.platformFee || 0),
                workerEarning: Number(booking.workerEarning || 0),
                totalAmount: Number(booking.totalAmount || 0),
                currency: 'PKR',
                amountText: `Rs. ${amount.toLocaleString()}`,
            },
            communication: {
                isLocked: isCommunicationLocked,
                reason: isCommunicationLocked ? 'Booking ended' : '',
            }
        }
    };
};

/**
 * @description Create a new booking
 * @route POST /api/v1/bookings
 * @access Private (User)
 */
export const createBooking = async (req: AuthRequest, res: Response) => {
    const session = await mongoose.startSession();
    try {
        const customerId = req.tokenPayload?.id;
        if (!customerId) {
            res.status(401).json({ success: false, message: "Unauthorized" });
            return;
        }

        const {
            worker: workerId, category, description,
            estimatedHours, address, longitude, latitude,
            bookingType = 'scheduled',
            imageUrls = [],
            videoUrls = [],
            audioUrls = []
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

        let booking: any = null;

        await session.withTransaction(async () => {
            // Fetch authoritative worker data
            const workerProfile = await Worker.findById(workerId).session(session);
            if (!workerProfile) {
                const error = new Error("Worker not found");
                (error as any).statusCode = 404;
                throw error;
            }

            if (!workerAcceptsJobType(workerProfile, bookingType)) {
                const error = new Error(`This worker is not accepting ${bookingType} bookings right now`);
                (error as any).statusCode = 409;
                throw error;
            }

            if (bookingType === 'instant') {
                const busy = await Booking.findOne({
                    worker: workerId,
                    status: { $in: ['accepted', 'ongoing'] }
                }).session(session);
                if (busy) {
                    const error = new Error("Worker is currently busy");
                    (error as any).statusCode = 409;
                    throw error;
                }
            }

            const hourlyRate = workerProfile.hourlyRate;
            const subtotal = estimatedHours * hourlyRate;
            const platformFee = await calculateCommissionAmount(subtotal);
            const totalAmount = subtotal;
            const workerEarning = subtotal - platformFee;
            const walletSettings = await getWalletSettings();

            const location = (longitude !== undefined && latitude !== undefined) ? {
                type: "Point",
                coordinates: [longitude, latitude]
            } : undefined;

            const expiresAt = bookingType === 'instant'
                ? new Date(Date.now() + 2 * 60 * 1000)
                : new Date(Date.now() + 24 * 60 * 60 * 1000);

            const [createdBooking] = await Booking.create([{
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
                agreement: {
                    clientOffer: subtotal,
                    agreedPrice: subtotal,
                    cashDue: subtotal,
                    priceSource: 'direct_rate',
                    commissionRateSnapshot: walletSettings.commissionEnabled ? walletSettings.platformFeePercentage : 0,
                    commissionAmount: platformFee,
                    workerNetIncome: workerEarning,
                    lockedAt: new Date(),
                    pricingVersion: 2
                },
                address,
                bookingType,
                imageUrls,
                videoUrls,
                audioUrls,
                expiresAt,
                ...(location && { location })
            }], { session });

            booking = createdBooking;
            await syncPaymentForBookingStatus(booking, session);
        });

        // Emit socket event to the worker
        const io = getIO();
        const eventPayload = bookingType === 'instant' 
            ? { ...booking.toObject(), urgent: true } 
            : booking;
        emitBookingEvent(io, eventPayload, 'booking:new');
        
        // Send push notification to the specific worker
        sendNotificationToRecipient(
            workerId,
            'worker',
            'New Direct Booking Request! 📅',
            `You have received a new booking request for ${category}.`,
            { bookingId: booking._id.toString(), type: 'booking_new' }
        ).catch(err => logger.error(`Failed to send direct booking push notification to worker ${workerId}:`, err));

        res.status(201).json({
            success: true,
            message: "Booking created successfully",
            data: booking
        });
    } catch (error: any) {
        logger.error("Error in createBooking:", error);
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({ success: false, message: error.message || "Internal server error" });
    } finally {
        await session.endSession();
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
            { path: 'customer', select: 'fullName email phone profileImage address city createdAt isActive' },
            { path: 'worker', select: 'fullName email phone profileImage category rating totalJobs totalReviews hourlyRate experience city address isVerified isAvailable' }
        ]);

        const responseBooking = buildBookingCardPayload(
            booking,
            userType === 'worker' ? 'worker' : 'user'
        );

        res.status(200).json({
            success: true,
            data: responseBooking
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
            .populate('worker', 'fullName phone email profileImage category rating totalJobs totalReviews hourlyRate experience city address isVerified isAvailable')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        const responseBookings = bookings.map((booking) => buildBookingCardPayload(booking, 'user'));

        const total = await Booking.countDocuments({ customer: customerId });

        res.status(200).json({
            success: true,
            data: responseBookings,
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
 * @description Lightweight home summary for client dashboard and recent bookings
 * @route GET /api/v1/bookings/home-summary (Users)
 * @access Private (User)
 */
export const getClientHomeSummary = async (req: AuthRequest, res: Response) => {
    try {
        const customerId = req.tokenPayload?.id;
        if (!customerId) {
            res.status(401).json({ success: false, message: "Unauthorized" });
            return;
        }

        const recentLimit = Math.min(parseInt(req.query.recentLimit as string) || 3, 10);
        const customerObjectId = new Types.ObjectId(customerId);
        const activeStatuses = ['accepted', 'ongoing'];

        const [recentBookings, total, completed, active, spentSummary] = await Promise.all([
            Booking.find({ customer: customerId })
                .populate('worker', 'fullName phone email profileImage category rating totalJobs totalReviews hourlyRate experience city address isVerified isAvailable')
                .sort({ createdAt: -1 })
                .limit(recentLimit),
            Booking.countDocuments({ customer: customerId }),
            Booking.countDocuments({ customer: customerId, status: 'completed' }),
            Booking.countDocuments({ customer: customerId, status: { $in: activeStatuses } }),
            Booking.aggregate([
                { $match: { customer: customerObjectId, status: 'completed' } },
                {
                    $group: {
                        _id: null,
                        totalSpent: {
                            $sum: {
                                $ifNull: ['$agreement.cashDue', { $ifNull: ['$totalAmount', 0] }]
                            }
                        }
                    }
                }
            ])
        ]);

        const successRate = total > 0 ? completed / total : 0;
        const totalSpent = Number(spentSummary[0]?.totalSpent || 0);

        res.status(200).json({
            success: true,
            data: {
                stats: {
                    total,
                    active,
                    completed,
                    successRate,
                    successRateLabel: total > 0 ? `${Math.round(successRate * 100)}%` : '100%',
                    totalSpent
                },
                recentBookings: recentBookings.map((booking) => buildBookingCardPayload(booking, 'user'))
            }
        });
    } catch (error: any) {
        logger.error("Error in getClientHomeSummary:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Lightweight worker home summary for earnings, stats, and recent bookings
 * @route GET /api/v1/bookings/worker-home-summary (Workers)
 * @access Private (Worker)
 */
export const getWorkerHomeSummary = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        if (!workerId) {
            res.status(401).json({ success: false, message: "Unauthorized" });
            return;
        }

        const recentLimit = Math.min(parseInt(req.query.recentLimit as string) || 3, 10);
        const workerObjectId = new Types.ObjectId(workerId);
        const operationalActiveStatuses = ['accepted', 'ongoing'];

        const [recentBookings, total, completed, active, earningSummary, workerProfile] = await Promise.all([
            Booking.find({ worker: workerId })
                .populate('customer', 'fullName phone email profileImage address city createdAt isActive')
                .sort({ createdAt: -1 })
                .limit(recentLimit),
            Booking.countDocuments({ worker: workerId }),
            Booking.countDocuments({ worker: workerId, status: 'completed' }),
            Booking.countDocuments({ worker: workerId, status: { $in: operationalActiveStatuses } }),
            Booking.aggregate([
                { $match: { worker: workerObjectId, status: 'completed' } },
                { $group: { _id: null, revenue: { $sum: { $ifNull: ['$workerEarning', 0] } } } }
            ]),
            Worker.findById(workerId).select('rating totalEarnings').lean(),
        ]);

        const successRate = total > 0 ? completed / total : 0;
        const calculatedRevenue = Number(earningSummary[0]?.revenue || 0);
        const profileRevenue = Number((workerProfile as any)?.totalEarnings || 0);

        res.status(200).json({
            success: true,
            data: {
                stats: {
                    revenue: Math.max(profileRevenue, calculatedRevenue),
                    rating: Number((workerProfile as any)?.rating || 0),
                    missions: total,
                    total,
                    completed,
                    successRate,
                    successRateLabel: total > 0 ? `${Math.round(successRate * 100)}%` : '100%',
                    activeCount: active,
                },
                recentBookings: recentBookings.map((booking) => buildBookingCardPayload(booking, 'worker')),
            }
        });
    } catch (error: any) {
        logger.error("Error in getWorkerHomeSummary:", error);
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

        // Optional status filter: e.g. ?status=cancelled or ?status=accepted,completed
        const statusParam = req.query.status as string | undefined;
        const query: any = { worker: workerId };
        if (statusParam) {
            const statuses = statusParam.split(',').map(s => s.trim());
            query.status = { $in: statuses };
        }

        const bookings = await Booking.find(query)
            .populate('customer', 'fullName phone email profileImage address city createdAt isActive')
            .sort({ createdAt: -1 }) // Newest first — ensures cancelled/recent bookings are always visible
            .skip(skip)
            .limit(limit);
        const responseBookings = bookings.map((booking) => buildBookingCardPayload(booking, 'worker'));

        const total = await Booking.countDocuments(query);

        res.status(200).json({
            success: true,
            data: responseBookings,
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
    const session = await mongoose.startSession();
    try {
        const { id } = req.params;
        const { status: nextStatus, cancelReason } = req.body;
        const userId = req.tokenPayload?.id;
        const userType = req.tokenPayload?.type; // 'user', 'worker', or 'admin'

        let booking: any = null;

        await session.withTransaction(async () => {
            booking = await Booking.findById(id).session(session);

            if (!booking) {
                const error = new Error("Booking not found");
                (error as any).statusCode = 404;
                throw error;
            }

            // Verify ownership
            if (!isAuthorizedForBooking(booking, req.tokenPayload)) {
                const error = new Error("Forbidden: You are not authorized to update this booking");
                (error as any).statusCode = 403;
                throw error;
            }

            const currentStatus = booking.status;

            // 1. Prevent updates to terminal states
            if (currentStatus === 'completed' || currentStatus === 'cancelled') {
                const error = new Error(`Cannot update booking from terminal state: ${currentStatus}`);
                (error as any).statusCode = 400;
                throw error;
            }

            // 2. Define allowed transitions and role permissions
            const isWorker = booking.worker.toString() === userId;
            const isAdmin = userType === 'admin' || req.tokenPayload?.role === 'admin' || req.tokenPayload?.role === 'superadmin';
            let isTransitionAllowed = false;

            if (isAdmin) {
                isTransitionAllowed = true;
            } else {
                switch (nextStatus) {
                    case 'accepted':
                        if (currentStatus === 'pending' && isWorker) isTransitionAllowed = true;
                        break;
                    case 'ongoing':
                        if (currentStatus === 'accepted' && isWorker) isTransitionAllowed = true;
                        break;
                    case 'completed':
                        if (currentStatus === 'ongoing' && isWorker) isTransitionAllowed = true;
                        break;
                    case 'cancelled':
                        isTransitionAllowed = true;
                        break;
                    default:
                        isTransitionAllowed = false;
                }
            }

            if (!isTransitionAllowed) {
                const error = new Error(`Invalid transition from ${currentStatus} to ${nextStatus} for role ${userType}`);
                (error as any).statusCode = 400;
                throw error;
            }

            if (nextStatus === 'accepted' && isWorker) {
                const walletEligibility = await getWalletEligibility(userId as string, Number(booking.platformFee || 0), session);
                if (!walletEligibility.isEligible) {
                    const error = new Error(buildInsufficientBalanceMessage(walletEligibility.requiredBalance, walletEligibility.availableBalance));
                    (error as any).statusCode = 402;
                    (error as any).requiredBalance = walletEligibility.requiredBalance;
                    (error as any).currentBalance = walletEligibility.availableBalance;
                    throw error;
                }
                const walletSettings = await getWalletSettings();
                await reserveCommission({
                    workerId: userId as string,
                    bookingId: booking._id,
                    amount: Number(booking.agreement?.commissionAmount ?? booking.platformFee ?? 0),
                    commissionRateSnapshot: Number(
                        booking.agreement?.commissionRateSnapshot
                        ?? (walletSettings.commissionEnabled ? walletSettings.platformFeePercentage : 0)
                    )
                }, { session });
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

            await booking.save({ session });

            if (nextStatus === 'cancelled') {
                await releaseCommissionReservation(booking._id, { session });
            }
            await syncPaymentForBookingStatus(booking, session);
            await syncLinkedJobPostStatus(booking);
        });

        // Emit socket event (outside transaction)
        const io = getIO();
        emitBookingEvent(io, booking, nextStatus === 'cancelled' ? 'booking:cancelled' : `booking:${nextStatus}`);

        res.status(200).json({
            success: true,
            message: `Booking status updated to ${nextStatus}`,
            data: booking
        });
    } catch (error: any) {
        logger.error("Error in updateBookingStatus:", error);
        const statusCode = error.statusCode || 500;
        
        // Handle specific wallet validation response
        if (statusCode === 402) {
            res.status(402).json({
                success: false,
                requiredBalance: error.requiredBalance,
                currentBalance: error.currentBalance,
                message: error.message
            });
            return;
        }
        
        res.status(statusCode).json({ success: false, message: error.message || "Internal server error" });
    } finally {
        await session.endSession();
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
/**
 * @description Mark booking as paid
 * @route POST /api/v1/bookings/:id/pay
 * @access Private (User)
 */
export const payBooking = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { paymentMethod = 'cash', notes = '' } = req.body;
        const userId = req.tokenPayload?.id;

        const booking = await Booking.findById(id);

        if (!booking) {
            return res.status(404).json({ success: false, message: "Booking not found" });
        }

        // Verify ownership (Only the involved customer can pay)
        if (booking.customer.toString() !== userId) {
            return res.status(403).json({ success: false, message: "Forbidden: You are not authorized to pay for this booking" });
        }

        if (booking.status !== 'completed') {
            return res.status(400).json({ success: false, message: "Cannot pay for a booking that is not completed" });
        }

        if (booking.paymentStatus === 'paid') {
            return res.status(400).json({ success: false, message: "Booking is already paid" });
        }

        if (paymentMethod !== 'cash') {
            return res.status(400).json({ success: false, message: "Only cash payments are supported in this version" });
        }

        const payment = await confirmCashPaymentForBooking(booking, 'customer', notes);

        // Emit socket event to notify worker
        const io = getIO();
        emitBookingEvent(io, booking, 'booking:paid');

        res.status(200).json({
            success: true,
            message: "Cash payment recorded successfully",
            data: {
                booking,
                payment
            }
        });
    } catch (error: any) {
        logger.error("Error in payBooking:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};
