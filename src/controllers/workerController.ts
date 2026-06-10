import Workers from "../models/Workers";
import VerificationRequest from "../models/VerificationRequest";
import { requestVerificationSchema } from "../validations/worker.validation";
import { ConflictError, InternalServerError, BadRequestError, ForbiddenError, UnauthorizedError } from "../utils/ApiError";
import { successResponse } from "../utils/ApiResponse";
import { asyncHandler } from "../utils/asyncHandler";
import { UploadRequest } from "../middlewares/multer.middleware";
import { generateToken, generateRefreshToken, verifyRefreshToken, AuthRequest, blacklistToken } from "../middlewares/jwt.middleware";
import {
    createPrimarySpecialtyFromLegacyCategory,
    normalizeSpecialtyProfileInput,
    setWorkerPrimarySpecialtyFromLegacyCategory
} from "../services/workerSpecialtyService";

/**
 * Upload worker profile image to ImageKit → /workers/profile-images/
 * @route POST /api/v1/workers/upload-profile-image
 */
export const uploadWorkerProfileImage = asyncHandler(async (req: UploadRequest, res) => {
    if (!req.uploadedImageUrl) {
        throw new BadRequestError("Profile image upload failed or no image provided");
    }
    return successResponse(res, 200, "Profile image uploaded successfully", {
        imageUrl: req.uploadedImageUrl,
    });
});

/**
 * Upload worker CNIC front image to ImageKit → /workers/cnic/
 * @route POST /api/v1/workers/upload-cnic-front
 */
export const uploadWorkerCnicFront = asyncHandler(async (req: UploadRequest, res) => {
    if (!req.uploadedImageUrl) {
        throw new BadRequestError("CNIC front image upload failed or no image provided");
    }
    return successResponse(res, 200, "CNIC front image uploaded successfully", {
        imageUrl: req.uploadedImageUrl,
    });
});

/**
 * Upload worker CNIC back image to ImageKit → /workers/cnic/
 * @route POST /api/v1/workers/upload-cnic-back
 */
export const uploadWorkerCnicBack = asyncHandler(async (req: UploadRequest, res) => {
    if (!req.uploadedImageUrl) {
        throw new BadRequestError("CNIC back image upload failed or no image provided");
    }
    return successResponse(res, 200, "CNIC back image uploaded successfully", {
        imageUrl: req.uploadedImageUrl,
    });
});

/**
 * Check if a worker exists by phone
 * @route GET /api/v1/workers/check-worker
 */
export const checkWorkerExists = asyncHandler(async (req, res) => {
    const { phone } = req.query;

    if (!phone) {
        throw new BadRequestError("Phone number is required");
    }

    const worker = await Workers.findOne({ phone: phone as string });

    return successResponse(res, 200, "Worker check completed", {
        exists: !!worker
    });
});

/**
 * Register a new worker
 * @route POST /api/v1/workers/register
 *
 * Flow (same as user registration):
 *   1. Client uploads each image via dedicated endpoint → gets back a URL
 *   2. Client sends all URLs as strings in the register body
 *   3. This controller saves the URLs directly to the database
 */
export const registerWorker = asyncHandler(async (req, res) => {
    const {
        fullName, phone, email, password, cnicNumber,
        profileImage, cnicFrontImage, cnicBackImage,
        category, skills, hourlyRate, bio,
        experience, city, address,
        latitude, longitude, fcmToken,
    } = req.body;

    // URLs come from body — already uploaded via dedicated endpoints
    const profileImageUrl = profileImage || "";
    const cnicFrontImageUrl = cnicFrontImage || "";
    const cnicBackImageUrl = cnicBackImage || "";

    const existingWorker = await Workers.findOne({ phone });
    if (existingWorker) {
        throw new ConflictError("Worker with this phone number already exists");
    }

    if (email) {
        const existingWorkerByEmail = await Workers.findOne({ email });
        if (existingWorkerByEmail) {
            throw new ConflictError("Worker with this email already exists");
        }
    }

    const existingWorkerCnic = await Workers.findOne({ cnicNumber });
    if (existingWorkerCnic) {
        throw new ConflictError("Worker with this CNIC number already exists");
    }
    const primaryProfile = normalizeSpecialtyProfileInput({ skills, hourlyRate, experience, bio });

    const worker = await Workers.create({
        fullName,
        phone,
        email,
        password,
        cnicNumber,
        cnicFrontImage: cnicFrontImageUrl,
        cnicBackImage: cnicBackImageUrl,
        category,
        specialties: await createPrimarySpecialtyFromLegacyCategory({
            categoryName: category,
            profile: primaryProfile
        }),
        skills: primaryProfile.skills,
        hourlyRate: primaryProfile.hourlyRate,
        bio: primaryProfile.bio,
        experience: primaryProfile.experience,
        city,
        address,
        location: {
            type: "Point",
            coordinates: [longitude, latitude],
        },
        profileImage: profileImageUrl,
        fcmToken,
    });

    const createdWorker = await Workers.findById(worker._id).select("-fcmToken");

    if (!createdWorker) {
        throw new InternalServerError("Something went wrong while registering the worker");
    }

    return successResponse(res, 201, "Worker registered successfully", createdWorker);
});


export const loginWorker = asyncHandler(async (req, res) => {
    const { phone, email, password, fcmToken } = req.body;

    const worker = await Workers.findOne({
        $or: [{ phone }, { email }]
    }).select("+password");

    if (!worker) {
        throw new UnauthorizedError("Invalid credentials");
    }

    const isPasswordCorrect = await worker.isPasswordCorrect(password);
    if (!isPasswordCorrect) {
        throw new UnauthorizedError("Invalid credentials");
    }

    if (fcmToken) {
        worker.fcmToken = fcmToken;
        await worker.save();
    }

    const accessToken = generateToken({
        id: worker._id.toString(),
        username: worker.fullName,
        type: 'worker'
    });

    const refreshToken = generateRefreshToken({
        id: worker._id.toString(),
        username: worker.fullName,
        type: 'worker'
    });

    // Save refresh token
    worker.refreshToken = refreshToken;
    await worker.save();

    // Remove sensitive fields
    const workerResponse = worker.toObject();
    delete workerResponse.password;
    delete workerResponse.fcmToken;
    delete workerResponse.refreshToken;

    return successResponse(res, 200, "Worker logged in successfully", {
        worker: workerResponse,
        token: accessToken,
        refreshToken: refreshToken
    });
});

/**
 * Refresh Worker Access Token
 * @route POST /api/v1/workers/refresh-token
 */
export const refreshWorkerAccessToken = asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        throw new BadRequestError("Refresh token is required");
    }

    // Verify token
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
        throw new UnauthorizedError("Invalid or expired refresh token");
    }

    // Check if worker exists and token matches
    const worker = await Workers.findById(payload.id);
    if (!worker || worker.refreshToken !== refreshToken) {
        throw new UnauthorizedError("Invalid refresh token");
    }

    // Generate new tokens
    const newAccessToken = generateToken({
        id: worker._id.toString(),
        username: worker.fullName,
        type: 'worker'
    });

    const newRefreshToken = generateRefreshToken({
        id: worker._id.toString(),
        username: worker.fullName,
        type: 'worker'
    });

    // Update refresh token in DB
    worker.refreshToken = newRefreshToken;
    await worker.save();

    return successResponse(res, 200, "Token refreshed successfully", {
        token: newAccessToken,
        refreshToken: newRefreshToken
    });
});


export const getWorkerById = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Authorization Check: Worker can only see their own profile, or Admin can see any
    if (req.tokenPayload?.id !== id && req.tokenPayload?.role !== 'admin' && req.tokenPayload?.role !== 'superadmin') {
        throw new ForbiddenError("You are not authorized to view this profile");
    }

    const worker = await Workers.findById(id).select("-password -fcmToken");
    if (!worker) {
        throw new BadRequestError("Worker not found");
    }
    return successResponse(res, 200, "Worker fetched successfully", worker);
});

/**
 * Get the authenticated worker's account moderation status.
 * @route GET /api/v1/workers/me/status
 */
export const getMyWorkerAccountStatus = asyncHandler(async (req: AuthRequest, res) => {
    const workerId = req.tokenPayload?.id;
    if (!workerId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const worker = await Workers.findById(workerId).select("isActive deactivationReason deactivatedAt");
    if (!worker) {
        throw new BadRequestError("Worker not found");
    }

    return successResponse(res, 200, "Account status fetched successfully", {
        isActive: worker.isActive,
        deactivationReason: worker.deactivationReason || '',
        deactivatedAt: worker.deactivatedAt || null,
    });
});

export const updateWorkerProfile = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Authorization Check
    if (req.tokenPayload?.id !== id && req.tokenPayload?.role !== 'admin' && req.tokenPayload?.role !== 'superadmin') {
        throw new ForbiddenError("You are not authorized to update this profile");
    }

    const {
        fullName, phone, email, bio, experience,
        city, address, hourlyRate, skills, category,
        latitude, longitude, profileImage, fcmToken, isAvailable,
        isInstantAvailable, isScheduledAvailable
    } = req.body;

    const worker = await Workers.findById(id);
    if (!worker) throw new BadRequestError("Worker not found");

    if (latitude !== undefined && latitude !== null) worker.location.coordinates[1] = latitude;
    if (longitude !== undefined && longitude !== null) worker.location.coordinates[0] = longitude;

    if (email !== undefined) {
        const existingWorkerEmail = await Workers.findOne({ email, _id: { $ne: id as any } });
        if (existingWorkerEmail) throw new ConflictError("Email already in use by another worker");
        worker.email = email;
    }
    if (phone !== undefined) {
        const existingWorkerPhone = await Workers.findOne({ phone, _id: { $ne: id as any } });
        if (existingWorkerPhone) throw new ConflictError("Phone number already in use by another worker");
        worker.phone = phone;
    }
    const primaryProfileChanged = bio !== undefined || experience !== undefined || hourlyRate !== undefined || skills !== undefined;
    if (bio !== undefined) worker.bio = bio;
    if (experience !== undefined) worker.experience = experience;
    if (city !== undefined) worker.city = city;
    if (address !== undefined) worker.address = address;
    if (hourlyRate !== undefined) worker.hourlyRate = hourlyRate;
    if (skills !== undefined) worker.skills = skills;
    if (category !== undefined || primaryProfileChanged) {
        await setWorkerPrimarySpecialtyFromLegacyCategory({ worker, categoryName: category || worker.category });
    }
    if (profileImage !== undefined) worker.profileImage = profileImage;
    if (fcmToken !== undefined) worker.fcmToken = fcmToken;
    const wasAvailable = worker.isAvailable !== false;
    if (isInstantAvailable !== undefined || isScheduledAvailable !== undefined) {
        worker.isInstantAvailable = isInstantAvailable !== undefined
            ? Boolean(isInstantAvailable)
            : worker.isInstantAvailable !== false;
        worker.isScheduledAvailable = isScheduledAvailable !== undefined
            ? Boolean(isScheduledAvailable)
            : worker.isScheduledAvailable !== false;
        worker.isAvailable = worker.isInstantAvailable || worker.isScheduledAvailable;
    } else if (isAvailable !== undefined) {
        // Legacy callers can still use the master switch.
        worker.isAvailable = Boolean(isAvailable);
        if (!worker.isAvailable) {
            worker.isInstantAvailable = false;
            worker.isScheduledAvailable = false;
        } else if (worker.isInstantAvailable === false && worker.isScheduledAvailable === false) {
            worker.isInstantAvailable = true;
            worker.isScheduledAvailable = true;
        }
    }
    if (worker.isAvailable && !wasAvailable) {
        worker.lastOnlineAt = new Date();
    }

    try {
        await worker.save();
    } catch (error: any) {
        if (error.code === 11000) {
            throw new ConflictError("Email or phone number already in use");
        }
        throw error;
    }
    const updatedWorker = await Workers.findById(id).select("-password -fcmToken -refreshToken");
    return successResponse(res, 200, "Worker updated successfully", updatedWorker);
});

export const deleteWorker = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Authorization Check
    if (req.tokenPayload?.id !== id && req.tokenPayload?.role !== 'admin' && req.tokenPayload?.role !== 'superadmin') {
        throw new ForbiddenError("You are not authorized to delete this worker");
    }

    const worker = await Workers.findById(id);
    if (!worker) throw new BadRequestError("Worker not found");
    await worker.deleteOne();
    return successResponse(res, 200, "Worker deleted successfully", {});
});

export const changeWorkerPassword = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Authorization Check
    if (req.tokenPayload?.id !== id) {
        throw new ForbiddenError("You can only change your own password");
    }

    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) throw new BadRequestError("Password is required");

    const worker = await Workers.findById(id).select("+password");
    if (!worker) throw new BadRequestError("Worker not found");

    const isPasswordCorrect = await worker.isPasswordCorrect(oldPassword);
    if (!isPasswordCorrect) throw new BadRequestError("Invalid old password");

    if (newPassword === oldPassword) throw new BadRequestError("New password cannot be same as old password");

    worker.password = newPassword;
    await worker.save();
    return successResponse(res, 200, "Password changed successfully", {});
});

export const logoutAllWorkerSessions = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    if (req.tokenPayload?.id !== id) {
        throw new ForbiddenError("You can only reset your own sessions");
    }

    const worker = await Workers.findById(id).select("+refreshToken");
    if (!worker) throw new BadRequestError("Worker not found");

    const accessToken = generateToken({
        id: worker._id.toString(),
        username: worker.fullName,
        type: 'worker'
    });

    const refreshToken = generateRefreshToken({
        id: worker._id.toString(),
        username: worker.fullName,
        type: 'worker'
    });

    worker.refreshToken = refreshToken;
    await worker.save();

    const safeWorker = await Workers.findById(id).select("-password -fcmToken -refreshToken");

    return successResponse(res, 200, "Sessions reset successfully", {
        token: accessToken,
        refreshToken,
        worker: safeWorker
    });
});

export const updateWorkerEmail = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Authorization Check
    if (req.tokenPayload?.id !== id) {
        throw new ForbiddenError("You can only update your own email");
    }

    const { email } = req.body;

    if (!email) throw new BadRequestError("Email is required");

    const worker = await Workers.findById(id);
    if (!worker) throw new BadRequestError("Worker not found");

    // Check for email uniqueness
    const existingWorker = await Workers.findOne({ email, _id: { $ne: id as any } });
    if (existingWorker) throw new ConflictError("Email already in use by another worker");

    worker.email = email;
    try {
        await worker.save();
    } catch (error: any) {
        if (error.code === 11000) {
            throw new ConflictError("Email already in use");
        }
        throw error;
    }
    return successResponse(res, 200, "Email updated successfully", worker);
});

export const updateWorkerProfileImage = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Authorization Check
    if (req.tokenPayload?.id !== id) {
        throw new ForbiddenError("You can only update your own profile image");
    }

    const { profileImage } = req.body;

    if (!profileImage) throw new BadRequestError("Profile image is required");

    const worker = await Workers.findById(id);
    if (!worker) throw new BadRequestError("Worker not found");
    worker.profileImage = profileImage;
    await worker.save();
    return successResponse(res, 200, "Profile image updated successfully", worker);
});

export const updateWorkerLocation = asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;

    // Authorization Check
    if (req.tokenPayload?.id !== id) {
        throw new ForbiddenError("You can only update your own location");
    }

    const { latitude, longitude } = req.body;

    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) throw new BadRequestError("Latitude and longitude are required");

    const worker = await Workers.findById(id);
    if (!worker) throw new BadRequestError("Worker not found");
    worker.location.coordinates[1] = latitude;
    worker.location.coordinates[0] = longitude;
    await worker.save();
    return successResponse(res, 200, "Location updated successfully", worker);
});

/**
 * Logout Worker
 * @route POST /api/v1/workers/logout
 */
export const logoutWorker = asyncHandler(async (req: AuthRequest, res) => {
    const token = req.token;
    if (token) {
        await blacklistToken(token);
    }
    
    if (req.tokenPayload?.id) {
        const worker = await Workers.findById(req.tokenPayload.id);
        if (worker) {
            worker.refreshToken = "";
            await worker.save();
        }
    }
    
    return successResponse(res, 200, "Logged out successfully", {});
});

/**
 * Request identity verification
 * @route POST /api/v1/workers/verification/request
 */
export const requestVerification = asyncHandler(async (req: AuthRequest, res) => {
    const workerId = req.tokenPayload?.id;
    if (!workerId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const worker = await Workers.findById(workerId);
    if (!worker) {
        throw new BadRequestError("Worker not found");
    }

    if (worker.isVerified) {
        throw new BadRequestError("Worker is already verified");
    }

    const validation = requestVerificationSchema.safeParse(req.body);
    if (!validation.success) {
        throw new BadRequestError(validation.error?.issues[0]?.message || "Validation failed");
    }

    const { cnicNumber, cnicFrontImage, cnicBackImage } = validation.data;

    // Check unique verified CNIC in Worker accounts
    const cnicVerifiedExists = await Workers.findOne({ cnicNumber, _id: { $ne: worker._id }, isVerified: true });
    if (cnicVerifiedExists) {
        throw new ConflictError("CNIC number is already registered and verified with another account");
    }

    // Check if worker already has a pending review
    const pendingRequest = await VerificationRequest.findOne({ worker: worker._id, status: 'pending' });
    if (pendingRequest) {
        throw new BadRequestError("You already have a pending verification request under review");
    }

    // Check if another account has a pending review with the same CNIC
    const duplicateCnicPending = await VerificationRequest.findOne({ cnicNumber, status: 'pending', worker: { $ne: worker._id } });
    if (duplicateCnicPending) {
        throw new ConflictError("This CNIC number is currently under review for another account");
    }

    const newRequest = await VerificationRequest.create({
        worker: worker._id,
        cnicNumber,
        cnicFrontImage,
        cnicBackImage,
        status: 'pending',
    });

    return successResponse(res, 201, "Verification request submitted successfully", newRequest);
});

/**
 * Get current verification status
 * @route GET /api/v1/workers/verification/status
 */
export const getVerificationStatus = asyncHandler(async (req: AuthRequest, res) => {
    const workerId = req.tokenPayload?.id;
    if (!workerId) {
        throw new UnauthorizedError("Unauthorized access");
    }

    const request = await VerificationRequest.findOne({ worker: workerId }).sort({ createdAt: -1 });
    return successResponse(res, 200, "Verification status fetched successfully", request || null);
});
