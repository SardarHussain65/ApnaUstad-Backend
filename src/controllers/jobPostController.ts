import { Response } from "express";
import { AuthRequest } from "../middlewares/jwt.middleware";
import { UploadRequest } from "../middlewares/multer.middleware";
import JobPost from "../models/JobPost";
import JobBid from "../models/JobBid";
import Worker from "../models/Workers";
import Booking from "../models/Booking";
import { getConfig } from "../config/env";
import logger from "../config/logger";
import { syncPaymentForBookingStatus } from "../services/paymentLedgerService";

const MAX_BIDS = 5;
const DEFAULT_JOB_RADIUS_METERS = 100000;
const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @description Create a new open Job Post
 * @route POST /api/v1/jobs
 * @access Private (User)
 */
export const createJobPost = async (req: AuthRequest, res: Response) => {
    try {
        const customerId = req.tokenPayload?.id;
        if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const {
            category, description, urgency,
            longitude, latitude, address,
            imageUrl, imageUrls, amount
        } = req.body;

        let { scheduledDate, scheduledTime } = req.body;

        if (urgency === 'instant') {
            const now = new Date();
            scheduledDate = now;
            scheduledTime = now.toTimeString().split(' ')[0]?.substring(0, 5) || "00:00";
        } else {
            if (!scheduledDate || !scheduledTime) {
                return res.status(400).json({ success: false, message: "Scheduled date and time are required for scheduled jobs" });
            }
        }

        if (longitude === undefined || latitude === undefined) {
            return res.status(400).json({ success: false, message: "Location coordinates (longitude, latitude) are required" });
        }

        const expiresAt = urgency === 'instant'
            ? new Date(Date.now() + 10 * 60 * 1000) // 10 minutes for instant
            : new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours for scheduled

        const jobPost = await JobPost.create({
            customer: customerId,
            category,
            description,
            urgency,
            scheduledDate,
            scheduledTime,
            address,
            location: {
                type: "Point",
                coordinates: [longitude, latitude]
            },
            imageUrl,
            imageUrls,
            amount,
            expiresAt
        });

        // 1. Emit socket event
        const io = require('../sockets/socketManager').getIO();

        // Broadcast to relevant workers
        logger.info(`📡 Job Broadcast: Finding workers for category: ${category} at [${longitude}, ${latitude}]`);

        const nearbyWorkers = await Worker.find({
            category: new RegExp(`^${escapeRegex(category)}$`, 'i'),
            isAvailable: true,
            isActive: true,
            location: {
                $near: {
                    $geometry: { type: "Point", coordinates: [longitude, latitude] },
                    $maxDistance: DEFAULT_JOB_RADIUS_METERS
                }
            }
        }).limit(10).select('_id');

        logger.info(`📡 Found ${nearbyWorkers.length} workers to notify: ${nearbyWorkers.map(w => w._id).join(', ')}`);

        // Broadcast to relevant workers
        nearbyWorkers.forEach(worker => {
            io.to(`worker:${worker._id.toString()}`).emit('job:new', jobPost);
        });

        res.status(201).json({
            success: true,
            data: jobPost,
            message: `Job post created and broadcasted to ${nearbyWorkers.length} workers.`
        });
    } catch (error: any) {
        logger.error("Error in createJobPost:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Submit a bid for a Job Post
 * @route POST /api/v1/jobs/:jobId/bids
 * @access Private (Worker)
 */
export const submitBid = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        if (!workerId || req.tokenPayload?.type !== 'worker') {
            return res.status(401).json({ success: false, message: "Unauthorized as worker" });
        }

        const { jobId } = req.params;
        const { message, proposedPrice } = req.body;

        const jobPost = await JobPost.findById(jobId);
        if (!jobPost) return res.status(404).json({ success: false, message: "Job post not found" });

        if (jobPost.status !== 'open') {
            return res.status(400).json({ success: false, message: "This job is no longer open for bids" });
        }

        if (jobPost.expiresAt < new Date()) {
            return res.status(400).json({ success: false, message: "This job post has expired" });
        }

        // Check Max Bids
        const bidCount = await JobBid.countDocuments({ jobPost: jobId });
        if (bidCount >= MAX_BIDS && jobPost.urgency !== 'instant') {
            return res.status(400).json({ success: false, message: "Maximum number of bids reached for this job." });
        }

        // Create Bid
        const newBid = await JobBid.create({
            jobPost: jobId,
            worker: workerId,
            message,
            proposedPrice
        });

        // Cap Bidding: if we just hit the MAX_BIDS, change job status to reviewing
        if ((bidCount + 1) >= MAX_BIDS && jobPost.urgency !== 'instant') {
            jobPost.status = 'reviewing';
            await jobPost.save();
        }

        const io = require('../sockets/socketManager').getIO();

        // Notify Client immediately
        await newBid.populate('worker', 'fullName profileImage averageRating');
        io.to(`user:${jobPost.customer.toString()}`).emit('bid:new', newBid);
        io.to(`worker:${workerId.toString()}`).emit('bid:submitted', { bidId: newBid._id, jobId: jobPost._id });

        res.status(201).json({
            success: true,
            data: newBid,
            message: "Bid submitted successfully"
        });

    } catch (error: any) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: "You have already placed a bid on this job." });
        }
        logger.error("Error in submitBid:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Accept a Bid and create a Booking
 * @route POST /api/v1/jobs/bids/:bidId/accept
 * @access Private (User)
 */
export const acceptBid = async (req: AuthRequest, res: Response) => {
    try {
        const customerId = req.tokenPayload?.id;
        const { bidId } = req.params;

        const bid = await JobBid.findById(bidId);
        if (!bid) return res.status(404).json({ success: false, message: "Bid not found" });

        const jobPost = await JobPost.findById(bid.jobPost);
        if (!jobPost) return res.status(404).json({ success: false, message: "Associated job post not found" });

        logger.info(`🔍 acceptBid Check: customerId=${customerId}, jobCustomer=${jobPost.customer.toString()}, status=${jobPost.status}`);

        if (jobPost.customer.toString() !== customerId) {
            logger.warn(`🚫 acceptBid: Unauthorized. Customer mismatch. User: ${customerId}, Job Owner: ${jobPost.customer}`);
            return res.status(403).json({ success: false, message: "Forbidden" });
        }

        if (jobPost.status !== 'open') {
            logger.warn(`🚫 acceptBid: Job status is ${jobPost.status}, not 'open'`);
            return res.status(400).json({
                success: false,
                message: `Job cannot be assigned. Current status: ${jobPost.status}`,
                currentStatus: jobPost.status
            });
        }

        // Update JobPost & Bid statuses
        jobPost.status = 'assigned';
        await jobPost.save();

        bid.status = 'accepted';
        await bid.save();

        // Reject other pending bids
        await JobBid.updateMany(
            { jobPost: jobPost._id, _id: { $ne: bid._id } },
            { $set: { status: 'rejected' } }
        );

        // Fetch worker details to populate rate or other stuff if needed
        const workerProfile = await Worker.findById(bid.worker);

        // Calculate costs (assuming proposedPrice is flat rate for the job for simplicity)
        const config = getConfig();
        const baseAmount = bid.proposedPrice;
        const platformFeePercentage = config.platformFeePercentage || 10;
        const platformFee = Math.round((baseAmount * (platformFeePercentage / 100)) * 100) / 100;

        const booking = await Booking.create({
            customer: customerId,
            worker: bid.worker,
            category: jobPost.category,
            description: jobPost.description,
            scheduledDate: jobPost.scheduledDate,
            scheduledTime: jobPost.scheduledTime,
            estimatedHours: 1, // Optional: might need to adjust based on bid or job post
            hourlyRate: workerProfile ? workerProfile.hourlyRate : 0, // Fallback
            subtotal: baseAmount,
            platformFee: platformFee,
            totalAmount: baseAmount + platformFee,
            workerEarning: baseAmount - platformFee,
            address: jobPost.address,
            location: jobPost.location,
            imageUrls: jobPost.imageUrls || [],
            bookingType: jobPost.urgency,
            status: 'accepted', // Auto accepted since they bid on it
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
        });
        await syncPaymentForBookingStatus(booking);

        // Notify winner and losers
        const io = require('../sockets/socketManager').getIO();
        io.to(`worker:${bid.worker.toString()}`).emit('bid:won', { jobPost, booking });

        const otherBids = await JobBid.find({ jobPost: jobPost._id, _id: { $ne: bid._id } });
        otherBids.forEach(ob => {
            io.to(`worker:${ob.worker.toString()}`).emit('bid:lost', { jobPost });
        });

        res.status(200).json({
            success: true,
            data: booking,
            message: "Bid accepted and booking created."
        });

    } catch (error: any) {
        logger.error("Error in acceptBid:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get a single Job Post
 * @route GET /api/v1/jobs/:jobId
 * @access Private (User, Worker, Admin)
 */
export const getJobPostById = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const userId = req.tokenPayload?.id;
        const userType = req.tokenPayload?.type;
        const userRole = req.tokenPayload?.role;
        const isAdmin = userType === 'admin' || userRole === 'admin' || userRole === 'superadmin';

        const jobPost = await JobPost.findById(jobId)
            .populate('customer', 'fullName profileImage phone');

        if (!jobPost) {
            return res.status(404).json({ success: false, message: "Job post not found" });
        }

        const customerId = (jobPost.customer as any)?._id?.toString?.() || jobPost.customer.toString();
        const isOwner = customerId === userId;

        if (userType === 'user' && !isOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }

        // Include bidCount
        const bidCount = await JobBid.countDocuments({ jobPost: jobId });
        const jobWithBidCount = {
            ...jobPost.toObject(),
            bidCount
        };

        res.status(200).json({ success: true, data: jobWithBidCount });
    } catch (error: any) {
        logger.error("Error in getJobPostById:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get Jobs nearby for a Worker
 * @route GET /api/v1/jobs/nearby
 */
export const getNearbyJobs = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        const worker = await Worker.findById(workerId).select('category location isActive isAvailable');

        if (!worker) {
            return res.status(404).json({ success: false, message: "Worker not found" });
        }

        const queryLongitude = req.query.longitude ? parseFloat(req.query.longitude as string) : undefined;
        const queryLatitude = req.query.latitude ? parseFloat(req.query.latitude as string) : undefined;
        const savedLongitude = worker.location?.coordinates?.[0];
        const savedLatitude = worker.location?.coordinates?.[1];

        const longitude = Number.isFinite(queryLongitude) ? queryLongitude : savedLongitude;
        const latitude = Number.isFinite(queryLatitude) ? queryLatitude : savedLatitude;

        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
            return res.status(400).json({ success: false, message: "Worker location coordinates are required" });
        }

        const category = (req.query.category as string | undefined) || worker.category;
        const maxDistance = req.query.radius
            ? Math.min(parseInt(req.query.radius as string, 10) || DEFAULT_JOB_RADIUS_METERS, DEFAULT_JOB_RADIUS_METERS)
            : DEFAULT_JOB_RADIUS_METERS;

        const query: any = {
            status: 'open',
            expiresAt: { $gt: new Date() },
            location: {
                $near: {
                    $geometry: { type: "Point", coordinates: [longitude, latitude] },
                    $maxDistance: maxDistance
                }
            }
        };

        if (category) query.category = new RegExp(`^${escapeRegex(category)}$`, 'i');

        const jobs = await JobPost.find(query)
            .populate('customer', 'fullName profileImage')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: jobs });
    } catch (error: any) {
        logger.error("Error in getNearbyJobs:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get jobs posted while the worker was offline (missed jobs)
 * @route GET /api/v1/jobs/missed
 * @access Private (Worker)
 */
export const getMissedJobs = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        const worker = await Worker.findById(workerId).select('category location isActive lastOnlineAt');

        if (!worker) {
            return res.status(404).json({ success: false, message: "Worker not found" });
        }

        const longitude = worker.location?.coordinates?.[0];
        const latitude = worker.location?.coordinates?.[1];

        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
            return res.status(400).json({ success: false, message: "Worker location not set" });
        }

        // Use lastOnlineAt as the cutoff; fall back to 4 hours ago if never set
        const FALLBACK_HOURS = 4;
        const since: Date = worker.lastOnlineAt
            ? new Date(worker.lastOnlineAt)
            : new Date(Date.now() - FALLBACK_HOURS * 60 * 60 * 1000);

        // Find jobs the worker has already bid on (to exclude them)
        const existingBidJobIds = await JobBid.find({ worker: workerId })
            .distinct('jobPost');

        const query: any = {
            status: 'open',
            expiresAt: { $gt: new Date() },
            createdAt: { $gt: since },
            _id: { $nin: existingBidJobIds },
            location: {
                $near: {
                    $geometry: { type: "Point", coordinates: [longitude, latitude] },
                    $maxDistance: DEFAULT_JOB_RADIUS_METERS
                }
            }
        };

        if (worker.category) {
            query.category = new RegExp(`^${escapeRegex(worker.category)}$`, 'i');
        }

        const jobs = await JobPost.find(query)
            .populate('customer', 'fullName profileImage')
            .sort({ createdAt: -1 })
            .limit(20);

        res.status(200).json({ success: true, data: jobs });
    } catch (error: any) {
        logger.error("Error in getMissedJobs:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get Bids for a given Job Post
 * @route GET /api/v1/jobs/:jobId/bids
 */
export const getJobBids = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const bids = await JobBid.find({ jobPost: jobId })
            .populate('worker', 'fullName profileImage averageRating')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: bids });
    } catch (e) {
        res.status(500).json({ success: false });
    }
}

/**
 * @description Get bids submitted by the authenticated worker
 * @route GET /api/v1/jobs/my-bids
 * @access Private (Worker)
 */
export const getWorkerBids = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        if (!workerId || req.tokenPayload?.type !== 'worker') {
            return res.status(401).json({ success: false, message: "Unauthorized as worker" });
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const skip = (page - 1) * limit;
        const statusParam = req.query.status as string | undefined;
        const allowedStatuses = ['pending', 'accepted', 'rejected'];
        const statuses = statusParam
            ? statusParam.split(',').map(s => s.trim()).filter(s => allowedStatuses.includes(s))
            : ['pending'];

        const query: any = { worker: workerId };
        if (statuses.length > 0) {
            query.status = { $in: statuses };
        }

        const bids = await JobBid.find(query)
            .populate({
                path: 'jobPost',
                select: 'customer category description urgency scheduledDate scheduledTime address location amount imageUrl imageUrls status expiresAt createdAt updatedAt',
                populate: { path: 'customer', select: 'fullName profileImage phone' }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await JobBid.countDocuments(query);

        res.status(200).json({
            success: true,
            data: bids,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error: any) {
        logger.error("Error in getWorkerBids:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Withdraw a pending worker bid/mission interest
 * @route DELETE /api/v1/jobs/bids/:bidId
 * @access Private (Worker)
 */
export const withdrawBid = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        const { bidId } = req.params;

        if (!workerId || req.tokenPayload?.type !== 'worker') {
            return res.status(401).json({ success: false, message: "Unauthorized as worker" });
        }

        const bid = await JobBid.findById(bidId);
        if (!bid) {
            return res.status(404).json({ success: false, message: "Bid not found" });
        }

        if (bid.worker.toString() !== workerId) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }

        if (bid.status !== 'pending') {
            return res.status(400).json({ success: false, message: "Only pending bids can be withdrawn" });
        }

        const jobPost = await JobPost.findById(bid.jobPost).select('customer category status expiresAt');
        await bid.deleteOne();

        if (jobPost?.status === 'reviewing') {
            const remainingBidCount = await JobBid.countDocuments({ jobPost: jobPost._id });
            if (remainingBidCount < MAX_BIDS && jobPost.expiresAt > new Date()) {
                jobPost.status = 'open';
                await jobPost.save();
            }
        }

        const io = require('../sockets/socketManager').getIO();
        if (jobPost?.customer) {
            io.to(`user:${jobPost.customer.toString()}`).emit('bid:withdrawn', {
                bidId,
                jobId: jobPost._id,
                category: jobPost.category
            });
        }

        res.status(200).json({
            success: true,
            message: "Mission interest withdrawn successfully",
            data: { bidId, jobId: jobPost?._id }
        });
    } catch (error: any) {
        logger.error("Error in withdrawBid:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Accept an Instant Job Post
 * @route POST /api/v1/jobs/:jobId/accept-instant
 * @access Private (Worker)
 */
export const acceptInstantJob = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        if (!workerId || req.tokenPayload?.type !== 'worker') {
            return res.status(401).json({ success: false, message: "Unauthorized as worker" });
        }

        const { jobId } = req.params;

        const jobPost = await JobPost.findById(jobId);
        if (!jobPost) return res.status(404).json({ success: false, message: "Job post not found" });

        if (jobPost.urgency !== 'instant') {
            return res.status(400).json({ success: false, message: "This API is only for instant jobs." });
        }

        if (jobPost.status !== 'open') {
            return res.status(400).json({ success: false, message: "Job is already taken or closed." });
        }

        if (jobPost.expiresAt < new Date()) {
            return res.status(400).json({ success: false, message: "This job post has expired" });
        }

        // Check if worker already bid
        const existingBid = await JobBid.findOne({ jobPost: jobId, worker: workerId });
        if (existingBid) {
            return res.status(400).json({ success: false, message: "You have already accepted this mission." });
        }

        // Create a Bid instead of assigning immediately
        const workerProfile = await Worker.findById(workerId);
        const newBid = await JobBid.create({
            jobPost: jobId,
            worker: workerId,
            message: "Instant Mission Acceptance",
            proposedPrice: workerProfile ? workerProfile.hourlyRate : 0,
            status: 'pending'
        });

        // Populate worker details for the client
        await newBid.populate('worker', 'fullName profileImage averageRating hourlyRate');

        const io = require('../sockets/socketManager').getIO();

        // Notify client that a worker is interested
        const roomName = `user:${jobPost.customer.toString()}`;
        logger.info(`📡 Emitting bid:new to room ${roomName} for worker ${workerProfile?.fullName}`);
        io.to(roomName).emit('bid:new', newBid);
        io.to(`worker:${workerId.toString()}`).emit('bid:submitted', { bidId: newBid._id, jobId: jobPost._id });

        res.status(200).json({
            success: true,
            data: newBid,
            message: "Mission interest registered. Waiting for client confirmation."
        });

    } catch (error: any) {
        logger.error("Error in acceptInstantJob:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get all job posts created by the authenticated user
 * @route GET /api/v1/jobs/my-posts
 * @access Private (User)
 */
export const getMyJobPosts = async (req: AuthRequest, res: Response) => {
    try {
        const customerId = req.tokenPayload?.id;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;

        const jobs = await JobPost.find({ customer: customerId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // Include bidCount for each job
        const jobsWithBidCount = await Promise.all(jobs.map(async (job) => {
            const bidCount = await JobBid.countDocuments({ jobPost: job._id });
            return {
                ...job.toObject(),
                bidCount
            };
        }));

        const total = await JobPost.countDocuments({ customer: customerId });

        res.status(200).json({
            success: true,
            data: jobsWithBidCount,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error: any) {
        logger.error("Error in getMyJobPosts:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Upload images for a job post
 * @route POST /api/v1/jobs/upload-images
 * @access Private (User)
 */
export const uploadJobImages = async (req: UploadRequest, res: Response) => {
    try {
        if (!req.uploadedImageUrls || req.uploadedImageUrls.length === 0) {
            return res.status(400).json({ success: false, message: "No images uploaded" });
        }
        res.status(200).json({
            success: true,
            data: {
                imageUrls: req.uploadedImageUrls
            },
            message: "Images uploaded successfully"
        });
    } catch (error: any) {
        logger.error("Error in uploadJobImages:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Cancel an open Job Post
 * @route POST /api/v1/jobs/:jobId/cancel
 * @access Private (User)
 */
export const cancelJobPost = async (req: AuthRequest, res: Response) => {
    try {
        const customerId = req.tokenPayload?.id;
        if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const { jobId } = req.params;

        const jobPost = await JobPost.findById(jobId);
        if (!jobPost) return res.status(404).json({ success: false, message: "Job post not found" });

        if (jobPost.customer.toString() !== customerId) {
            return res.status(403).json({ success: false, message: "Forbidden: You are not the owner of this job post." });
        }

        if (jobPost.status !== 'open' && jobPost.status !== 'reviewing') {
            return res.status(400).json({ success: false, message: `Job cannot be cancelled. Current status: ${jobPost.status}` });
        }

        // Set status to cancelled
        jobPost.status = 'cancelled';
        await jobPost.save();

        // Reject all pending bids
        const bids = await JobBid.find({ jobPost: jobId, status: 'pending' });
        await JobBid.updateMany(
            { jobPost: jobId, status: 'pending' },
            { $set: { status: 'rejected' } }
        );

        const io = require('../sockets/socketManager').getIO();

        // Broadcast cancellation to all workers who had pending bids
        bids.forEach(bid => {
            io.to(`worker:${bid.worker.toString()}`).emit('bid:lost', { jobPost });
        });

        // Broadcast to general workers (if they are on the radar)
        io.emit('job:cancelled', { jobId: jobPost._id });

        res.status(200).json({
            success: true,
            data: jobPost,
            message: "Job post cancelled successfully."
        });

    } catch (error: any) {
        logger.error("Error in cancelJobPost:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};
