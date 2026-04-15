import { Response } from "express";
import { AuthRequest } from "../middlewares/jwt.middleware";
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
            imageUrl
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
            ? new Date(Date.now() + 2 * 60 * 1000) // 2 minutes for instant
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
            expiresAt
        });

        // 1. Emit socket event
        const io = require('../sockets/socketManager').getIO();
        
        // Find nearby available workers, limit to closest 10
        const nearbyWorkers = await Worker.find({
            category: category,
            isAvailable: true,
            location: {
                $near: {
                    $geometry: { type: "Point", coordinates: [longitude, latitude] },
                    $maxDistance: 10000 // 10km
                }
            }
        }).limit(10).select('_id');

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

        const bid = await JobBid.findById(bidId).populate('jobPost');
        if (!bid) return res.status(404).json({ success: false, message: "Bid not found" });

        const jobPost = bid.jobPost as any; // Cast populated doc
        if (jobPost.customer.toString() !== customerId) {
             return res.status(403).json({ success: false, message: "Forbidden" });
        }

        if (jobPost.status !== 'open') {
             return res.status(400).json({ success: false, message: "Job is already assigned or closed." });
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
     } catch(e) {
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

        // Atomically update JobPost to avoid race conditions
        const updatedJob = await JobPost.findOneAndUpdate(
            { _id: jobId, status: 'open' },
            { $set: { status: 'assigned' } },
            { new: true }
        );

        if (!updatedJob) {
             return res.status(400).json({ success: false, message: "Job was already taken." });
        }

        // Fetch worker profile to get hourly rate
        const workerProfile = await Worker.findById(workerId);
        
        const config = getConfig();
        const baseAmount = workerProfile ? workerProfile.hourlyRate : 0;
        const platformFeePercentage = config.platformFeePercentage || 10;
        const platformFee = Math.round((baseAmount * (platformFeePercentage / 100)) * 100) / 100;
        
        // Auto-create a booking
        const booking = await Booking.create({
            customer: updatedJob.customer,
            worker: workerId,
            category: updatedJob.category,
            description: updatedJob.description,
            scheduledDate: updatedJob.scheduledDate,
            scheduledTime: updatedJob.scheduledTime,
            estimatedHours: 1, 
            hourlyRate: baseAmount,
            subtotal: baseAmount,
            platformFee: platformFee,
            totalAmount: baseAmount + platformFee,
            workerEarning: baseAmount - platformFee,
            address: updatedJob.address,
            location: updatedJob.location,
            bookingType: 'instant',
            status: 'accepted',
            expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) // Instant booking expires in 2 hours if not completed/started
        });

        const io = require('../sockets/socketManager').getIO();
        
        // Notify client
        io.to(`user:${updatedJob.customer.toString()}`).emit('job:assigned', { jobPost: updatedJob, booking });
        
        res.status(200).json({
            success: true,
            data: booking,
            message: "Instant job accepted and booking created."
        });

    } catch (error: any) {
         logger.error("Error in acceptInstantJob:", error);
         res.status(500).json({ success: false, message: "Internal server error" });
    }
};
