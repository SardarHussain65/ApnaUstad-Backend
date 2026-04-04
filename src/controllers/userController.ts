import User from "../models/User";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, ConflictError, InternalServerError, ForbiddenError, UnauthorizedError } from "../utils/ApiError";
import { successResponse } from "../utils/ApiResponse";
import { UploadRequest } from "../middlewares/multer.middleware";
import { generateToken, AuthRequest } from "../middlewares/jwt.middleware";

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
            coordinates: [
                longitude !== undefined && longitude !== null ? longitude : 0,
                latitude !== undefined && latitude !== null ? latitude : 0
            ]
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
    // 1. Get login credentials from request body
    const { phone, email, password } = req.body;


    // 3. Find user by phone number
    // Build $or query to check both fields
    const user = await User.findOne({
        $or: [
            { email: email },
            { phone: phone }
        ]
    }).select("+password +fcmToken");

    if (!user) {
        throw new UnauthorizedError("Invalid credentials");
    }

    const isPasswordCorrect = await user.isPasswordCorrect(password);
    if (!isPasswordCorrect) {
        throw new UnauthorizedError("Invalid credentials");
    }

    // 6. Generate JWT token
    const token = generateToken({ 
        id: user._id.toString(), 
        username: user.fullName,
        type: 'user'
    });

    // 7. Remove sensitive fields
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.fcmToken;

    // 8. Return response
    return successResponse(res, 200, "User logged in successfully", { user: userResponse, token });
});


export const getUserById = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;
    
    // Authorization Check: User can only see their own profile, or Admin can see any
    if (req.tokenPayload?.id !== id && req.tokenPayload?.role !== 'admin' && req.tokenPayload?.role !== 'superadmin') {
        throw new ForbiddenError("You are not authorized to view this profile");
    }

    const user = await User.findById(id).select("-password -fcmToken");
    if (!user) {
        throw new BadRequestError("User not found");
    }
    return successResponse(res, 200, "User fetched successfully", user);
});


export const updateProfile = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Authorization Check
    if (req.tokenPayload?.id !== id && req.tokenPayload?.role !== 'admin' && req.tokenPayload?.role !== 'superadmin') {
        throw new ForbiddenError("You are not authorized to update this profile");
    }

    const { fullName, email, phone, address, city, latitude, longitude, profileImage, fcmToken } = req.body;

    const user = await User.findById(id);
    if (!user) throw new BadRequestError("User not found");

    // Update location separately if needed
    if (latitude !== undefined && latitude !== null) user.location.coordinates[1] = latitude;
    if (longitude !== undefined && longitude !== null) user.location.coordinates[0] = longitude;

    // Conditionally update simple fields
    if (email !== undefined) {
        const existingEmail = await User.findOne({ email, _id: { $ne: id as any } });
        if (existingEmail) throw new ConflictError("Email already in use by another user");
        user.email = email;
    }
    if (phone !== undefined) {
        const existingPhone = await User.findOne({ phone, _id: { $ne: id as any } });
        if (existingPhone) throw new ConflictError("Phone number already in use by another user");
        user.phone = phone;
    }
    if (address !== undefined) user.address = address;
    if (city !== undefined) user.city = city;
    if (profileImage !== undefined) user.profileImage = profileImage;
    if (fcmToken !== undefined) user.fcmToken = fcmToken;

    try {
        await user.save();
    } catch (error: any) {
        if (error.code === 11000) {
            throw new ConflictError("Email or phone number already in use");
        }
        throw error;
    }
    return successResponse(res, 200, "User updated successfully", user);
});


export const deleteUser = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Authorization Check
    if (req.tokenPayload?.id !== id && req.tokenPayload?.role !== 'admin' && req.tokenPayload?.role !== 'superadmin') {
        throw new ForbiddenError("You are not authorized to delete this user");
    }

    const user = await User.findById(id);
    if (!user) throw new BadRequestError("User not found");
    await user.deleteOne();
    return successResponse(res, 200, "User deleted successfully", {});
});


export const changePassword = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Authorization Check
    if (req.tokenPayload?.id !== id) {
        throw new ForbiddenError("You can only change your own password");
    }

    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) throw new BadRequestError("Password is required");

    const user = await User.findById(id).select("+password");
    if (!user) throw new BadRequestError("User not found");

    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
    if (!isPasswordCorrect) throw new BadRequestError("Invalid old password");

    if (newPassword === oldPassword) throw new BadRequestError("New password cannot be same as old password");

    user.password = newPassword;
    await user.save();
    return successResponse(res, 200, "Password changed successfully", {});
});


export const updateEmail = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Authorization Check
    if (req.tokenPayload?.id !== id) {
        throw new ForbiddenError("You can only update your own email");
    }

    const { email } = req.body;

    if (!email) throw new BadRequestError("Email is required");

    const user = await User.findById(id);
    if (!user) throw new BadRequestError("User not found");

    // Check for email uniqueness
    const existingUser = await User.findOne({ email, _id: { $ne: id as any } });
    if (existingUser) throw new ConflictError("Email already in use by another user");

    user.email = email;
    try {
        await user.save();
    } catch (error: any) {
        if (error.code === 11000) {
            throw new ConflictError("Email already in use");
        }
        throw error;
    }
    return successResponse(res, 200, "Email updated successfully", user);
});


export const updateProfileImage = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Authorization Check
    if (req.tokenPayload?.id !== id) {
        throw new ForbiddenError("You can only update your own profile image");
    }

    const { profileImage } = req.body;

    if (!profileImage) throw new BadRequestError("Profile image is required");

    const user = await User.findById(id);
    if (!user) throw new BadRequestError("User not found");
    user.profileImage = profileImage;
    await user.save();
    return successResponse(res, 200, "Profile image updated successfully", user);
});


export const updateLocation = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Authorization Check
    if (req.tokenPayload?.id !== id) {
        throw new ForbiddenError("You can only update your own location");
    }

    const { latitude, longitude } = req.body;

    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) throw new BadRequestError("Latitude and longitude are required");

    const user = await User.findById(id);
    if (!user) throw new BadRequestError("User not found");
    user.location.coordinates[1] = latitude;
    user.location.coordinates[0] = longitude;
    await user.save();
    return successResponse(res, 200, "Location updated successfully", user);
});


