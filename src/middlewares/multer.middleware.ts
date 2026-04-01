import multer, { FileFilterCallback } from "multer";
import { Request, Response, NextFunction } from "express";
import { toFile } from "@imagekit/nodejs";


import imagekit from "../config/imagekit.config";



const storage = multer.memoryStorage();

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
    storage,       // use memoryStorage
    fileFilter,    // use our image-only filter
    limits: {
        fileSize: 5 * 1024 * 1024,  // 5MB max
    },
});

// -----------------------------------------------
// 🔷 STEP 4: UPLOAD TO IMAGEKIT (New SDK Way)
// -----------------------------------------------
// Official docs show this pattern:
// await client.files.upload({
//     file: await toFile(Buffer.from('my bytes'), 'file'),
//     fileName: 'fileName'
// });
//
// So the flow is:
// req.file.buffer (raw binary) → toFile() → imagekit.files.upload()

const uploadToImageKit = async (
    file: Express.Multer.File,
    folder: string = "profiles"
): Promise<string> => {

    // "toFile()" → official SDK helper that wraps a Buffer into
    // a File-like object that ImageKit's upload() understands
    // Arg 1: the Buffer (binary image data from multer)
    // Arg 2: the filename string
    const imageFile = await toFile(file.buffer, file.originalname);

    // "imagekit.files.upload()" → the new SDK method (note: .files.upload not .upload)
    // Old SDK: imagekit.upload({ file, fileName, folder })
    // New SDK: imagekit.files.upload({ file, fileName, folder })  ← note the ".files."
    const response = await imagekit.files.upload({
        file: imageFile,
        // The wrapped file object from toFile()

        fileName: `${Date.now()}-${file.originalname}`,
        // Unique filename → timestamp prefix prevents overwriting

        folder: `/${folder}`,
        // Folder in your ImageKit media library
        // e.g. "/profiles"
    });

    if (!response.url) {
        throw new Error("Failed to get image URL from ImageKit response");
    }

    return response.url;
    // "response.url" → the CDN URL of the uploaded image
    // e.g. "https://ik.imagekit.io/your_id/profiles/1711234567890-photo.jpg"
};

// -----------------------------------------------
// 🔷 STEP 5: COMBINED MIDDLEWARE
// -----------------------------------------------
// Extends Request to carry our custom uploadedImageUrl field

interface UploadRequest extends Request {
    uploadedImageUrl?: string;
}

const handleProfileImageUpload = (
    req: UploadRequest,
    res: Response,
    next: NextFunction
): void => {

    // Run multer first → processes multipart/form-data
    // .single("profileImage") → expects ONE file under field name "profileImage"
    upload.single("profileImage")(req, res, async (err) => {

        // Handle multer-specific errors (file too big, wrong field name, etc.)
        if (err instanceof multer.MulterError) {
            res.status(400).json({ error: err.message });
            return;
        }

        // Handle our custom errors (wrong file type from fileFilter)
        if (err) {
            res.status(400).json({ error: err.message });
            return;
        }

        // No file was attached to the request at all
        if (!req.file) {
            // Optional image: move to the route handler without error
            next();
            return;
        }

        try {
            // Upload buffer → ImageKit CDN → get back URL
            const imageUrl = await uploadToImageKit(req.file, "profiles");

            // Attach URL to request so the next route handler can use it
            req.uploadedImageUrl = imageUrl;

            next(); // ✅ move to the route handler
        } catch (uploadError) {
            console.error("ImageKit upload failed:", uploadError);

            // New SDK throws typed errors — from the docs:
            // if (err instanceof ImageKit.APIError) { err.status, err.name }
            res.status(500).json({ error: "Image upload failed" });
        }
    });
};

export { handleProfileImageUpload, uploadToImageKit };
export type { UploadRequest };
export default upload;