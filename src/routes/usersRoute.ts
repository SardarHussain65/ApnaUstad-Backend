import { Router } from "express";
import { registerUser, loginUser, uploadImage, updateProfileImage, updateLocation, getAllUsers, getUserById, updateProfile, changePassword, deleteUser, updateEmail } from "../controllers/userController";
import { handleProfileImageUpload } from "../middlewares/multer.middleware";
import validate from "../middlewares/validate.middleware";
import { registerUserSchema, loginUserSchema } from "../validations/user.validation";

const router = Router();

/**
 * @description Upload profile image to CDN
 * @access Public
 */
router.route("/upload-image").post(handleProfileImageUpload, uploadImage);

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
 * @description Get all users
 * @access Private
 */
router.route("/").get(getAllUsers);

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