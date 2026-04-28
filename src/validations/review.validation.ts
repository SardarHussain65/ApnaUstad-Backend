import { z } from "zod";

export const createReviewSchema = z.object({
    booking: z.string({ error: "Booking ID is required" }).length(24, "Invalid Booking ID format"),
    worker: z.string({ error: "Worker ID is required" }).length(24, "Invalid Worker ID format"),
    rating: z.number({ error: "Rating is required" }).min(1, "Rating must be between 1 and 5").max(5, "Rating must be between 1 and 5"),
    comment: z.string().max(500, "Comment cannot exceed 500 characters").optional()
});
