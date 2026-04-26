import multer, { FileFilterCallback } from "multer";
import { Request, Response, NextFunction } from "express";
import { toFile } from "@imagekit/nodejs";

import imagekit from "../config/imagekit.config";

// -----------------------------------------------
// 🔷 STEP 1: MEMORY STORAGE
// -----------------------------------------------
const storage = multer.memoryStorage();

// -----------------------------------------------
// 🔷 STEP 2: FILE FILTER (images only)
// -----------------------------------------------
const fileFilter = (
    req: Request,
    file: Express.Multer.File,
    callback: FileFilterCallback
): void => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (allowedTypes.includes(file.mimetype)) {
        callback(null, true);
    } else {
        callback(new Error("Only image files are allowed!"));
    }
};

// -----------------------------------------------
// 🔷 STEP 3: MULTER INSTANCE
// -----------------------------------------------
const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max
    },
});

// -----------------------------------------------
// 🔷 STEP 4: UPLOAD TO IMAGEKIT
// -----------------------------------------------
// req.file.buffer (raw binary) → toFile() → imagekit.files.upload()

const uploadToImageKit = async (
    file: Express.Multer.File,
    folder: string = "profiles"
): Promise<string> => {
    const imageFile = await toFile(file.buffer, file.originalname);

    const response = await imagekit.files.upload({
        file: imageFile,
        fileName: `${Date.now()}-${file.originalname}`,
        folder: `/${folder}`,
    });

    if (!response.url) {
        throw new Error("Failed to get image URL from ImageKit response");
    }

    return response.url;
};

// -----------------------------------------------
// 🔷 STEP 5: EXTENDED REQUEST TYPE
// -----------------------------------------------
interface UploadRequest extends Request {
    uploadedImageUrl?: string;
    uploadedImageUrls?: string[];
}

// -----------------------------------------------
// 🔷 STEP 6: MIDDLEWARE FACTORY
// -----------------------------------------------
// Creates a single-file upload middleware for any field name and ImageKit folder.
// This is the same pattern used for user profile images, reused for all worker images.
//
// Usage:
//   createUploadMiddleware("profileImage", "workers/profile-images")
//   createUploadMiddleware("cnicFrontImage", "workers/cnic")
//   createUploadMiddleware("cnicBackImage",  "workers/cnic")

const createUploadMiddleware = (fieldName: string, folder: string) => (
    req: UploadRequest,
    res: Response,
    next: NextFunction
): void => {
    upload.single(fieldName)(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            res.status(400).json({ error: err.message });
            return;
        }
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }

        // No file provided → optional, just continue
        if (!req.file) {
            next();
            return;
        }

        try {
            const imageUrl = await uploadToImageKit(req.file, folder);
            req.uploadedImageUrl = imageUrl;
            next();
        } catch (uploadError) {
            console.error(`ImageKit upload failed [${folder}]:`, uploadError);
            res.status(500).json({ error: "Image upload failed" });
        }
    });
};

const createMultipleUploadMiddleware = (fieldName: string, folder: string, maxCount: number = 5) => (
    req: UploadRequest,
    res: Response,
    next: NextFunction
): void => {
    upload.array(fieldName, maxCount)(req, res, async (err) => {
        if (err instanceof multer.MulterError) {
            res.status(400).json({ error: err.message });
            return;
        }
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }

        if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
            next();
            return;
        }

        try {
            const uploadPromises = (req.files as Express.Multer.File[]).map(file => uploadToImageKit(file, folder));
            const imageUrls = await Promise.all(uploadPromises);
            req.uploadedImageUrls = imageUrls;
            next();
        } catch (uploadError) {
            console.error(`ImageKit multiple upload failed [${folder}]:`, uploadError);
            res.status(500).json({ error: "Multiple images upload failed" });
        }
    });
};

// -----------------------------------------------
// 🔷 STEP 7: NAMED MIDDLEWARE INSTANCES
// -----------------------------------------------

// User
const handleProfileImageUpload = createUploadMiddleware("profileImage", "profiles");

// Jobs
const handleJobImagesUpload = createMultipleUploadMiddleware("images", "jobs", 5);

// Worker — 3 separate upload endpoints, all CNIC images go to the same /workers/cnic folder
const handleWorkerProfileImageUpload = createUploadMiddleware("profileImage",   "workers/profile-images");
const handleWorkerCnicFrontUpload    = createUploadMiddleware("cnicFrontImage", "workers/cnic");
const handleWorkerCnicBackUpload     = createUploadMiddleware("cnicBackImage",  "workers/cnic");

export {
    handleProfileImageUpload,
    handleJobImagesUpload,
    handleWorkerProfileImageUpload,
    handleWorkerCnicFrontUpload,
    handleWorkerCnicBackUpload,
    uploadToImageKit,
};
export type { UploadRequest };
export default upload;