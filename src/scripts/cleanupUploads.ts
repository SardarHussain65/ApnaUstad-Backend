import imagekit from "../config/imagekit.config";
import User from "../models/User";
import Worker from "../models/Workers";
import logger from "../config/logger";

/**
 * Scans ImageKit for orphaned files that are not referenced in the database.
 * Deletes any orphaned files older than 24 hours.
 */
export const cleanupOrphanedUploads = async () => {
    logger.info("Starting orphaned uploads cleanup process...");

    const folders = ["/profiles", "/workers/profile-images", "/workers/cnic"];
    const now = new Date();
    const threshold = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    let totalDeleted = 0;

    for (const folder of folders) {
        try {
            // List files in the current folder (limit 100 per batch)
            const files = await (imagekit as any).listFiles({
                path: folder,
                limit: 100,
            });

            if (!files || files.length === 0) {
                logger.info(`No files found in folder: ${folder}`);
                continue;
            }

            for (const file of files) {
                const createdAt = new Date(file.createdAt);
                
                // Skip files uploaded within the last 24 hours
                if (now.getTime() - createdAt.getTime() < threshold) {
                    continue;
                }

                // Check if the file's URL exists in User or Worker records
                const [userRef, workerRef] = await Promise.all([
                    User.exists({ profileImage: file.url }),
                    Worker.exists({
                        $or: [
                            { profileImage: file.url },
                            { cnicFrontImage: file.url },
                            { cnicBackImage: file.url }
                        ]
                    })
                ]);

                // If not referenced anywhere, delete from ImageKit
                // If not referenced anywhere, delete from ImageKit
                if (!userRef && !workerRef) {
                    logger.warn(`Deleting orphaned file: ${file.url} (FileID: ${file.fileId}, Folder: ${folder})`);
                    await (imagekit as any).deleteFile(file.fileId);
                    totalDeleted++;
                }
            }
        } catch (error: any) {
            logger.error(`Error during cleanup of folder ${folder}:`, error);
        }
    }

    logger.info(`Cleanup process completed. Total orphaned files deleted: ${totalDeleted}`);
};
