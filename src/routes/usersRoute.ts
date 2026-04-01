import { Router } from "express";
import { registerUser, loginUser, uploadImage } from "../controllers/userController";
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

export default router;
