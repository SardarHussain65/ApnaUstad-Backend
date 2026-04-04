import { Router } from "express";
import {
    registerWorker,
    uploadWorkerProfileImage,
    uploadWorkerCnicFront,
    uploadWorkerCnicBack,
    loginWorker,
    getWorkerById,
    updateWorkerProfile,
    deleteWorker,
    changeWorkerPassword,
    updateWorkerEmail,
    updateWorkerProfileImage,
    updateWorkerLocation
} from "../controllers/workerController";
import validate from "../middlewares/validate.middleware";
import { loginWorkerSchema, registerWorkerSchema } from "../validations/worker.validation";
import {
    handleWorkerProfileImageUpload,
    handleWorkerCnicFrontUpload,
    handleWorkerCnicBackUpload,
} from "../middlewares/multer.middleware";
import { workerAuthMiddleware } from "../middlewares/jwt.middleware";
import { uploadRateLimiter } from "../middlewares/rateLimiter.middleware";

const router = Router();

/**
 * @description Upload worker profile image → /workers/profile-images/ on ImageKit
 * @access Public
 */
router.route("/upload-profile-image").post(uploadRateLimiter, handleWorkerProfileImageUpload, uploadWorkerProfileImage);

/**
 * @description Upload worker CNIC front image → /workers/cnic/ on ImageKit
 * @access Public
 */
router.route("/upload-cnic-front").post(uploadRateLimiter, handleWorkerCnicFrontUpload, uploadWorkerCnicFront);

/**
 * @description Upload worker CNIC back image → /workers/cnic/ on ImageKit
 * @access Public
 */
router.route("/upload-cnic-back").post(uploadRateLimiter, handleWorkerCnicBackUpload, uploadWorkerCnicBack);

/**
 * @description Register a new worker (pass image URLs from upload endpoints in body)
 * @access Public
 */
router.route("/register").post(validate(registerWorkerSchema), registerWorker);


router.route("/login").post(validate(loginWorkerSchema), loginWorker);



router.use(workerAuthMiddleware)

/**
 * @description Get worker by ID
 * @access Private
 */
router.route("/:id").get(getWorkerById);

/**
 * @description Update worker profile
 * @access Private
 */
router.route("/:id").patch(updateWorkerProfile);

/**
 * @description Update worker profile image
 * @access Private
 */
router.route("/:id/profile-image").put(updateWorkerProfileImage);

/**
 * @description Change worker password
 * @access Private
 */
router.route("/:id/change-password").put(changeWorkerPassword);

/**
 * @description Update worker email
 * @access Private
 */
router.route("/:id/email").put(updateWorkerEmail);

/**
 * @description Delete worker
 * @access Private
 */
router.route("/:id").delete(deleteWorker);

/**
 * @description Update worker location
 * @access Private
 */
router.route("/:id/location").put(updateWorkerLocation);

export default router;
