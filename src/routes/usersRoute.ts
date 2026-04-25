import { Router } from "express";
import { 
    registerUser, loginUser, uploadImage, checkUserExists, 
    updateProfileImage, updateLocation, getUserById, 
    updateProfile, changePassword, deleteUser, 
    updateEmail, googleAuthUser, getCategories, 
    getWorkers,
    getWorkerById
} from "../controllers/userController";
import { handleProfileImageUpload } from "../middlewares/multer.middleware";
import validate from "../middlewares/validate.middleware";
import { registerUserSchema, loginUserSchema } from "../validations/user.validation";
import { userAuthMiddleware } from "../middlewares/jwt.middleware";
import { uploadRateLimiter } from "../middlewares/rateLimiter.middleware";

const router = Router();

/**
 * @description Upload profile image to CDN
 * @access Public
 */
router.route("/upload-image").post(uploadRateLimiter, handleProfileImageUpload, uploadImage);

/**
 * @description Register a new user
 * @access Public
 */
router.route("/register").post(validate(registerUserSchema), registerUser);

/**
 * @description Login a user
 * @access Public
 */
router.route("/login").post(validate(loginUserSchema), loginUser);

/**
 * @description Check if user exists by phone
 * @access Public
 */
router.route("/check-user").get(checkUserExists);

/**
 * @description Get all active categories (Public)
 * @access Public
 */
router.route("/categories").get(getCategories);


/**
 * @description Get all active worker (Public)
 * @access Public
 */
router.route("/workers").get(getWorkers);



/**
 * @description Get worker by ID
 * @access Public
 */
router.route("/workers/:id").get(getWorkerById);


/**
 * @description Login / Verify user with Google ID Token
 * @access Public
 */
router.route("/google-auth").post(googleAuthUser);



router.use(userAuthMiddleware)

/**
 * @description Get user by ID
 * @access Private
 */
router.route("/:id").get(getUserById);

/**
 * @description Update user profile
 * @access Private
 */
router.route("/:id").patch(updateProfile);


/**
 * @description Update user profile image
 * @access Private
 */
router.route("/:id/profile-image").put(updateProfileImage);



/**
 * @description Update user profile image
 * @access Private
 */
router.route("/:id/change-password").put(changePassword);


/**
 * @description Update user email
 * @access Private
 */
router.route("/:id/email").put(updateEmail);


/**
 * @description Delete user
 * @access Private
 */
router.route("/:id").delete(deleteUser);


/**
 * @description Update user location
 * @access Private
 */
router.route("/:id/location").put(updateLocation);


export default router;