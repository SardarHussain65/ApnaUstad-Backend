import Workers from "../models/Workers";
import { ConflictError, InternalServerError, BadRequestError } from "../utils/ApiError";
import { successResponse } from "../utils/ApiResponse";
import { asyncHandler } from "../utils/asyncHandler";
import { UploadRequest } from "../middlewares/multer.middleware";
import { generateToken } from "../middlewares/jwt.middleware";

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

    const worker = await Workers.create({
        fullName,
        phone,
        email,
        password,
        cnicNumber,
        cnicFrontImage: cnicFrontImageUrl,
        cnicBackImage: cnicBackImageUrl,
        category,
        skills,
        hourlyRate,
        bio,
        experience,
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
        throw new BadRequestError("Worker not found");
    }

    const isPasswordCorrect = await worker.isPasswordCorrect(password);
    if (!isPasswordCorrect) {
        throw new BadRequestError("Invalid password");
    }

    if (fcmToken) {
        worker.fcmToken = fcmToken;
        await worker.save();
    }

    const token = generateToken({ id: worker._id.toString(), username: worker.fullName });

    return successResponse(res, 200, "Worker logged in successfully", {
        worker,
        token,
    });
});

export const getAllWorkers = asyncHandler(async (req, res) => {
    const workers = await Workers.find().select("-password -fcmToken");
    return successResponse(res, 200, "Workers fetched successfully", workers);
});

export const getWorkerById = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const worker = await Workers.findById(id).select("-password -fcmToken");
    if (!worker) {
        throw new BadRequestError("Worker not found");
    }
    return successResponse(res, 200, "Worker fetched successfully", worker);
});

export const updateWorkerProfile = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
        fullName, phone, email, bio, experience,
        city, address, hourlyRate, skills, category,
        latitude, longitude, profileImage, fcmToken
    } = req.body;

    const worker = await Workers.findById(id);
    if (!worker) throw new BadRequestError("Worker not found");

    if (latitude) worker.location.coordinates[1] = latitude;
    if (longitude) worker.location.coordinates[0] = longitude;

    if (fullName !== undefined) worker.fullName = fullName;
    if (phone !== undefined) worker.phone = phone;
    if (email !== undefined) worker.email = email;
    if (bio !== undefined) worker.bio = bio;
    if (experience !== undefined) worker.experience = experience;
    if (city !== undefined) worker.city = city;
    if (address !== undefined) worker.address = address;
    if (hourlyRate !== undefined) worker.hourlyRate = hourlyRate;
    if (skills !== undefined) worker.skills = skills;
    if (category !== undefined) worker.category = category;
    if (profileImage !== undefined) worker.profileImage = profileImage;
    if (fcmToken !== undefined) worker.fcmToken = fcmToken;

    await worker.save();
    return successResponse(res, 200, "Worker updated successfully", worker);
});

export const deleteWorker = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const worker = await Workers.findById(id);
    if (!worker) throw new BadRequestError("Worker not found");
    await worker.deleteOne();
    return successResponse(res, 200, "Worker deleted successfully", {});
});

export const changeWorkerPassword = asyncHandler(async (req, res) => {
    const { id } = req.params;
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

export const updateWorkerEmail = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { email } = req.body;

    if (!email) throw new BadRequestError("Email is required");

    const worker = await Workers.findById(id);
    if (!worker) throw new BadRequestError("Worker not found");
    worker.email = email;
    await worker.save();
    return successResponse(res, 200, "Email updated successfully", worker);
});

export const updateWorkerProfileImage = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { profileImage } = req.body;

    if (!profileImage) throw new BadRequestError("Profile image is required");

    const worker = await Workers.findById(id);
    if (!worker) throw new BadRequestError("Worker not found");
    worker.profileImage = profileImage;
    await worker.save();
    return successResponse(res, 200, "Profile image updated successfully", worker);
});

export const updateWorkerLocation = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) throw new BadRequestError("Latitude and longitude are required");

    const worker = await Workers.findById(id);
    if (!worker) throw new BadRequestError("Worker not found");
    worker.location.coordinates[1] = latitude;
    worker.location.coordinates[0] = longitude;
    await worker.save();
    return successResponse(res, 200, "Location updated successfully", worker);
});