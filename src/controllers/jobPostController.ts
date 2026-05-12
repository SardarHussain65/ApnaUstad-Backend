import { Response } from "express";
import { AuthRequest } from "../middlewares/jwt.middleware";
import { UploadRequest } from "../middlewares/multer.middleware";
import JobPost from "../models/JobPost";
import JobBid from "../models/JobBid";
import Worker from "../models/Workers";
import Booking from "../models/Booking";
import { getConfig } from "../config/env";
import logger from "../config/logger";

const MAX_BIDS = 5;

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
            category: category,
            isAvailable: true,
            location: {
                $near: {
                    $geometry: { type: "Point", coordinates: [longitude, latitude] },
                    $maxDistance: 100000 // 100km
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
 * @description Get Jobs nearby for a Worker
 * @route GET /api/v1/jobs/nearby
 */
export const getNearbyJobs = async (req: AuthRequest, res: Response) => {
    try {
        const { longitude, latitude } = req.query;
        if (!longitude || !latitude) {
            return res.status(400).json({ success: false, message: "Location coordinates required" });
        }

        const category = req.query.category; // Optional filter

        const query: any = {
            status: 'open',
            expiresAt: { $gt: new Date() },
            location: {
                $near: {
                    $geometry: { type: "Point", coordinates: [parseFloat(longitude as string), parseFloat(latitude as string)] },
                    $maxDistance: 10000 // 10km
                }
            }
        };

        if (category) query.category = category;

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

        const total = await JobPost.countDocuments({ customer: customerId });

        res.status(200).json({
            success: true,
            data: jobs,
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
