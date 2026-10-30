// src/routes/disputeRoute.ts
import { Router } from "express";
import {
    raiseDispute,
    getMyDisputes,
    getDisputeByBooking,
    getDisputeForParty,
    getDisputeMessagesForParty,
    sendDisputeMessageAsParty,
    markDisputeReadAsParty,
    withdrawDispute,
    uploadDisputeEvidence,
} from "../controllers/disputeController";
import { jwtAuthMiddleware } from "../middlewares/jwt.middleware";
import { handleDisputeEvidenceUpload } from "../middlewares/multer.middleware";
import { uploadRateLimiter } from "../middlewares/rateLimiter.middleware";

const router = Router();

/**
 * All routes require JWT authentication
 */
router.use(jwtAuthMiddleware);

/**
 * @description Raise a dispute for a booking
 * @access Private (User or Worker)
 */
router.post("/", raiseDispute);

/**
 * @description Upload evidence photos (works for both customers and Ustads)
 * @access Private (User or Worker)
 */
router.post("/upload-evidence", uploadRateLimiter, handleDisputeEvidenceUpload, uploadDisputeEvidence);

/**
 * @description Get dispute context for a booking
 * @access Private (User or Worker on that booking)
 */
router.get("/booking/:bookingId", getDisputeByBooking);

/**
 * @description Get disputes involving the logged-in client or worker (?scope=active|history)
 * @access Private (User or Worker)
 */
router.get("/my", getMyDisputes);

/**
 * @description Case Room — details, messages, read receipts and withdraw
 * @access Private (Customer or Ustad on that dispute)
 */
router.get("/:id", getDisputeForParty);
router.get("/:id/messages", getDisputeMessagesForParty);
router.post("/:id/messages", sendDisputeMessageAsParty);
router.post("/:id/read", markDisputeReadAsParty);
router.post("/:id/withdraw", withdrawDispute);

export default router;
