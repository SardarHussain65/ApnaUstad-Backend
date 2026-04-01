import User from "../models/User";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, ConflictError, InternalServerError, AppError } from "../utils/ApiError";
import { successResponse } from "../utils/ApiResponse";
import { UploadRequest } from "../middlewares/multer.middleware";

/**
 * Handle direct image upload returning the ImageKit URL
 * @route POST /api/v1/users/upload-image
 */
export const uploadImage = asyncHandler(async (req: UploadRequest, res) => {
    if (!req.uploadedImageUrl) {
        throw new BadRequestError("Image upload failed or no image provided");
    }

    return successResponse(res, 200, "Image uploaded successfully", { imageUrl: req.uploadedImageUrl });
});

/**
 * Register a new user
 * @route POST /api/v1/users/register
 */
export const registerUser = asyncHandler(async (req, res) => {
    // 1. Get user data from request body
    // 1. Get user data from request body
    const {
        fullName,
        email,
        password,
        phone,
        address,
        city,
        latitude,
        longitude,
        profileImage,
        fcmToken
    } = req.body;

    // Use URL from body (already uploaded via /upload-image)
    const profileImageUrl = profileImage || "";


    // 3. Check if user already exists: phone or email
    const existedUserByPhone = await User.findOne({ phone });
    if (existedUserByPhone) {
        throw new ConflictError("User with this phone number already exists");
    }

    if (email) {
        const existedUserByEmail = await User.findOne({ email });
        if (existedUserByEmail) {
            throw new ConflictError("User with this email already exists");
        }
    }

    // 4. Create user object - create entry in db
    // Note: Password hashing is handled by the pre-save hook in User model
    const user = await User.create({
        fullName: fullName,
        email: email || null,
        password,
        phone,
        profileImage: profileImageUrl,
        address: address || "",
        city: city || "",
        location: {
            type: "Point",
            coordinates: [longitude || 0, latitude || 0]
        },
        fcmToken: fcmToken || ""
    });

    // 5. Remove password and fcmToken from response
    const createdUser = await User.findById(user._id).select("-password -fcmToken");

    // 6. Check for user creation
    if (!createdUser) {
        throw new InternalServerError("Something went wrong while registering the user");
    }

    // 7. Return response
    return successResponse(res, 201, "User registered successfully", createdUser);
});

/**
 * Login user (Placeholder for future implementation)
 */
export const loginUser = asyncHandler(async (req, res) => {
    // To be implemented with JWT logic
    throw new AppError(501, "Login functionality not implemented yet");
});
