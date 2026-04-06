import { Router } from "express";
import { createReview, getWorkerReviews } from "../controllers/reviewController";
import validate from "../middlewares/validate.middleware";
import { createReviewSchema } from "../validations/review.validation";
import { userAuthMiddleware } from "../middlewares/jwt.middleware";

const router = Router();

/**
 * @description Create a new review
 * @access Private (User)
 */
router.route("/").post(userAuthMiddleware, validate(createReviewSchema), createReview);

/**
 * @description Get all reviews for a specific worker
 * @access Public
 */
router.route("/worker/:workerId").get(getWorkerReviews);

export default router;
