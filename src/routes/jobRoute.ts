import { Router } from "express";
import { userAuthMiddleware, workerAuthMiddleware, jwtAuthMiddleware } from "../middlewares/jwt.middleware";
import {
    createJobPost,
    submitBid,
    acceptBid,
    getNearbyJobs,
    getMissedJobs,
    getJobBids,
    acceptInstantJob,
    getMyJobPosts,
    getJobPostById,
    getWorkerBids,
    withdrawBid,
    uploadJobImages,
    cancelJobPost
} from "../controllers/jobPostController";
import { handleJobImagesUpload } from "../middlewares/multer.middleware";

const router = Router();

// Upload job images (for users)
router.post("/upload-images", userAuthMiddleware, handleJobImagesUpload, uploadJobImages);

// Retrieve nearby jobs (for workers to see)
router.get("/nearby", workerAuthMiddleware, getNearbyJobs);

// Get jobs posted while the worker was offline
router.get("/missed", workerAuthMiddleware, getMissedJobs);

// Create a new job post (for users)
router.post("/", userAuthMiddleware, createJobPost);

// Get all job posts created by the authenticated user
router.get("/my-posts", userAuthMiddleware, getMyJobPosts);

// Get bids/interests submitted by the authenticated worker
router.get("/my-bids", workerAuthMiddleware, getWorkerBids);

// Withdraw a pending bid/mission interest
router.delete("/bids/:bidId", workerAuthMiddleware, withdrawBid);

// Submit a bid on a job post (for workers)
router.post("/:jobId/bids", workerAuthMiddleware, submitBid);

// Get all bids for a job post (for users)
router.get("/:jobId/bids", userAuthMiddleware, getJobBids);

// Accept a bid (for users)
router.post("/:jobId/bids/:bidId/accept", userAuthMiddleware, acceptBid);

// Accept an instant job (for workers)
router.post("/:jobId/accept-instant", workerAuthMiddleware, acceptInstantJob);

// Cancel a job post (for users)
router.post("/:jobId/cancel", userAuthMiddleware, cancelJobPost);

// Get a single job post
router.get("/:jobId", jwtAuthMiddleware, getJobPostById);

export default router;
