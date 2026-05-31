import User from "../models/User";
import Workers from "../models/Workers";
import Category from "../models/Category";
import Booking from "../models/Booking";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, ConflictError, InternalServerError, ForbiddenError, UnauthorizedError } from "../utils/ApiError";
import { successResponse } from "../utils/ApiResponse";
import { UploadRequest } from "../middlewares/multer.middleware";
import { generateToken, generateRefreshToken, verifyRefreshToken, AuthRequest, TokenPayload } from "../middlewares/jwt.middleware";
import admin from "../config/firebase";

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
 * Check if a user exists by phone
 * @route GET /api/v1/users/check-user
 */
export const checkUserExists = asyncHandler(async (req, res) => {
    const { phone } = req.query;

    if (!phone) {
        throw new BadRequestError("Phone number is required");
    }

    const user = await User.findOne({ phone: phone as string });

    return successResponse(res, 200, "User check completed", {
        exists: !!user
    });
});

/**
 * Get all active categories (Public for registration)
 * @route GET /api/v1/users/categories
 */
export const getCategories = asyncHandler(async (req, res) => {
    const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1 });
    return successResponse(res, 200, "Categories fetched successfully", categories);
});


/**
 * Get all workers with filtering and pagination
 * @route GET /api/v1/users/workers
 * @query {boolean} isActive - Filter by active status
 * @query {boolean} isAvailable - Filter by availability
 * @query {string} category - Filter by category
 * @query {string} city - Filter by city
 * @query {number} minRating - Filter by minimum rating
 * @query {number} page - Page number (default: 1)
 * @query {number} limit - Items per page (default: 10)
 */
export const getWorkers = asyncHandler(async (req, res) => {
    // Pagination parameters
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 10);
    const skip = (page - 1) * limit;

    // Build filter object
    const filter: any = {};

    // Filter by isActive
    if (req.query.isActive !== undefined) {
        filter.isActive = req.query.isActive === 'true';
    }

    // Filter by isAvailable
    if (req.query.isAvailable !== undefined) {
        filter.isAvailable = req.query.isAvailable === 'true';
    }

    // Filter by category
    if (req.query.category) {
        filter.category = req.query.category as string;
    }

    // Filter by city
    if (req.query.city) {
        filter.city = req.query.city as string;
    }

    // Filter by minimum rating
    if (req.query.minRating) {
        const minRating = parseFloat(req.query.minRating as string);
        if (!isNaN(minRating)) {
            filter.rating = { $gte: minRating };
        }
    }

    // Fetch workers with filters
    const workers = await Workers.find(filter)
        .select("-password -fcmToken -cnicNumber -cnicFrontImage -cnicBackImage -hourlyRate -location -address -city -experience -rating -reviews -phone -email")
        .skip(skip)
        .limit(limit)
        .lean();

    // Get total count for pagination metadata
    const totalWorkers = await Workers.countDocuments(filter);
    const totalPages = Math.ceil(totalWorkers / limit);

    return successResponse(res, 200, "Workers fetched successfully", {
        data: workers,
        pagination: {
            page,
            limit,
            totalWorkers,
            totalPages,
            hasNextPage: page < totalPages,
            hasPrevPage: page > 1
        }
    });
});



/**
 * Get worker by ID with sensitive data excluded
 * @route GET /api/v1/users/workers/:id
 */
export const getWorkerById = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const worker = await Workers.findById(id).select("-password -fcmToken -cnicNumber -cnicFrontImage -cnicBackImage -phone -email");
    if (!worker) {
        throw new BadRequestError("Worker not found");
    }
    return successResponse(res, 200, "Worker fetched successfully", worker);
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

    // 6. Generate JWT tokens
    const accessToken = generateToken({
        id: user._id.toString(),
        username: user.fullName,
        type: 'user'
    });

    const refreshToken = generateRefreshToken({
        id: user._id.toString(),
        username: user.fullName,
        type: 'user'
    });

    // Save refresh token to user record
    user.refreshToken = refreshToken;
    await user.save();

    // 7. Remove sensitive fields
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.fcmToken;
    delete userResponse.refreshToken;

    // 8. Return response
    return successResponse(res, 200, "User logged in successfully", {
        user: userResponse,
        token: accessToken,
        refreshToken: refreshToken
    });
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

/**
 * Get a safe public client profile for authenticated users.
 * @route GET /api/v1/users/public/:id
 */
export const getPublicUserProfile = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    const user = await User.findById(id).select("fullName profileImage address city createdAt isActive");
    if (!user) {
        throw new BadRequestError("User not found");
    }

    const [bookingStats] = await Booking.aggregate([
        { $match: { customer: user._id } },
        {
            $group: {
                _id: null,
                totalBookings: { $sum: 1 },
                completedBookings: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
                activeBookings: { $sum: { $cond: [{ $in: ["$status", ["pending", "accepted", "ongoing"]] }, 1, 0] } },
                cancelledBookings: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } }
            }
        }
    ]);
    const {
        totalBookings = 0,
        completedBookings = 0,
        activeBookings = 0,
        cancelledBookings = 0
    } = bookingStats || {};

    const resolvedBookings = completedBookings + cancelledBookings;
    const reliabilityRate = resolvedBookings > 0
        ? Math.round((completedBookings / resolvedBookings) * 100)
        : null;

    return successResponse(res, 200, "Client profile fetched successfully", {
        ...user.toObject(),
        stats: {
            totalBookings,
            completedBookings,
            activeBookings,
            cancelledBookings,
            reliabilityRate
        }
    });
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
    const updatedUser = await User.findById(id).select("-password -fcmToken -refreshToken");
    return successResponse(res, 200, "User updated successfully", updatedUser);
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

export const logoutAllSessions = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    if (req.tokenPayload?.id !== id) {
        throw new ForbiddenError("You can only reset your own sessions");
    }

    const user = await User.findById(id).select("+refreshToken");
    if (!user) throw new BadRequestError("User not found");

    const accessToken = generateToken({
        id: user._id.toString(),
        username: user.fullName,
        type: 'user'
    });

    const refreshToken = generateRefreshToken({
        id: user._id.toString(),
        username: user.fullName,
        type: 'user'
    });

    user.refreshToken = refreshToken;
    await user.save();

    const safeUser = await User.findById(id).select("-password -fcmToken -refreshToken");

    return successResponse(res, 200, "Sessions reset successfully", {
        token: accessToken,
        refreshToken,
        user: safeUser
    });
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

/**
 * Handle Google Authentication
 * @route POST /api/v1/users/google-auth
 */
export const googleAuthUser = asyncHandler(async (req, res) => {
    const { idToken } = req.body;

    if (!idToken) {
        throw new BadRequestError("Google ID Token is required");
    }

    if (!admin.apps.length) {
        throw new InternalServerError("Firebase is not configured on the server.");
    }

    // 1. Verify Token
    let decodedToken;
    try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (error: any) {
        console.error("Firebase Google Auth Error:", error?.code || error?.message || "Token verification failed");
        throw new UnauthorizedError("Invalid or expired Google ID token");
    }

    const { email, name, picture } = decodedToken;

    if (!email) {
        throw new BadRequestError("No email attached to this Google account");
    }

    // 2. Find User by Email
    const user = await User.findOne({ email }).select("+password +fcmToken");

    if (user) {
        // User exists -> Log them in
        const accessToken = generateToken({
            id: user._id.toString(),
            username: user.fullName,
            type: 'user'
        });

        const refreshToken = generateRefreshToken({
            id: user._id.toString(),
            username: user.fullName,
            type: 'user'
        });

        // Save refresh token
        user.refreshToken = refreshToken;
        await user.save();

        const userResponse = user.toObject();
        delete userResponse.password;
        delete userResponse.fcmToken;
        delete userResponse.refreshToken;

        return successResponse(res, 200, "User logged in successfully via Google", {
            exists: true,
            user: userResponse,
            token: accessToken,
            refreshToken: refreshToken
        });
    } else {
        // User does NOT exist -> Return data for registration completion
        return successResponse(res, 200, "Google verification successful, please complete profile", {
            exists: false,
            googleData: {
                email,
                fullName: name || "",
                profileImage: picture || ""
            }
        });
    }
});

/**
 * Refresh Access Token
 * @route POST /api/v1/users/refresh-token
 */
export const refreshAccessToken = asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        throw new BadRequestError("Refresh token is required");
    }

    // Verify token
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
        throw new UnauthorizedError("Invalid or expired refresh token");
    }

    // Check if user exists and token matches
    const user = await User.findById(payload.id);
    if (!user || user.refreshToken !== refreshToken) {
        throw new UnauthorizedError("Invalid refresh token");
    }

    // Generate new tokens
    const newAccessToken = generateToken({
        id: user._id.toString(),
        username: user.fullName,
        type: 'user'
    });

    const newRefreshToken = generateRefreshToken({
        id: user._id.toString(),
        username: user.fullName,
        type: 'user'
    });

    // Update refresh token in DB
    user.refreshToken = newRefreshToken;
    await user.save();

    return successResponse(res, 200, "Token refreshed successfully", {
        token: newAccessToken,
        refreshToken: newRefreshToken
    });
});
