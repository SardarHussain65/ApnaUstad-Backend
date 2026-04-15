import { Router } from "express";
import { userAuthMiddleware, workerAuthMiddleware, jwtAuthMiddleware } from "../middlewares/jwt.middleware";
import { createJobPost, submitBid, acceptBid, getNearbyJobs, getJobBids, acceptInstantJob } from "../controllers/jobPostController";

const router = Router();

// Retrieve nearby jobs (for workers to see)
router.get("/nearby", workerAuthMiddleware, getNearbyJobs);

// Create a new job post (for users)
router.post("/", userAuthMiddleware, createJobPost);

// Submit a bid on a job post (for workers)
router.post("/:jobId/bids", workerAuthMiddleware, submitBid);

// Get all bids for a job post (for users)
router.get("/:jobId/bids", userAuthMiddleware, getJobBids);

// Accept a bid (for users)
router.post("/bids/:bidId/accept", userAuthMiddleware, acceptBid);

// Accept an instant job (for workers)
router.post("/:jobId/accept-instant", workerAuthMiddleware, acceptInstantJob);

export default router;
