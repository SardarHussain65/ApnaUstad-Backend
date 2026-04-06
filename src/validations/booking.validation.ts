import { z } from "zod";

export const createBookingSchema = z.object({
    worker: z.string({ error: "Worker ID is required" }).length(24, "Invalid Worker ID format"),
    category: z.string({ error: "Category is required" }).min(2, "Category is too short"),
    description: z.string({ error: "Description is required" }).min(10, "Description must be at least 10 characters").max(1000, "Description is too long"),
    scheduledDate: z.string({ error: "Scheduled date is required" }).datetime({ offset: true, message: "Invalid datetime format for scheduledDate. Expected ISO string." }).or(z.string()),
    scheduledTime: z.string({ error: "Scheduled time is required" }),
    estimatedHours: z.number({ error: "Estimated hours is required" }).min(1).max(8),
    hourlyRate: z.number({ error: "Hourly rate is required" }).positive(),
    subtotal: z.number({ error: "Subtotal is required" }).positive(),
    platformFee: z.number({ error: "Platform fee is required" }).nonnegative(),
    totalAmount: z.number({ error: "Total amount is required" }).positive(),
    workerEarning: z.number({ error: "Worker earning is required" }).positive(),
    address: z.string().optional(),
    longitude: z.number().min(-180).max(180).optional(),
    latitude: z.number().min(-90).max(90).optional(),
});

export const updateBookingStatusSchema = z.object({
    status: z.enum(['pending', 'accepted', 'ongoing', 'completed', 'cancelled'], { error: "Status is required and must be valid" }),
    cancelReason: z.string().optional()
}).refine(data => {
    if (data.status === 'cancelled' && !data.cancelReason) {
        return false;
    }
    return true;
}, {
    message: "Cancel reason is required when status is cancelled",
    path: ["cancelReason"]
});
