import { z } from 'zod';

const optionalUrlArray = z.array(z.string().url()).max(5).optional();

export const createJobPostSchema = z.object({
    category: z.string({ error: 'Category is required' }).trim().min(2).max(100),
    description: z.string({ error: 'Description is required' }).trim().min(10).max(1000),
    urgency: z.enum(['instant', 'scheduled']).default('scheduled'),
    scheduledDate: z.union([z.string(), z.date()]).optional(),
    scheduledTime: z.string().trim().optional(),
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
    address: z.string().trim().min(2).max(500),
    amount: z.number({ error: 'Client offer is required' }).positive('Client offer must be greater than zero'),
    imageUrl: z.string().url().optional(),
    imageUrls: optionalUrlArray,
    videoUrl: z.string().url().optional(),
    videoUrls: optionalUrlArray,
    audioUrls: z.array(z.string().url()).max(1).optional(),
    targetWorkerId: z.string().length(24).optional()
}).superRefine((data, ctx) => {
    if (data.urgency === 'scheduled' && (!data.scheduledDate || !data.scheduledTime)) {
        ctx.addIssue({
            code: 'custom',
            path: ['scheduledDate'],
            message: 'Scheduled date and time are required for scheduled jobs'
        });
    }
});

export const submitJobBidSchema = z.object({
    message: z.string({ error: 'Proposal message is required' }).trim().min(1).max(500),
    proposedPrice: z.number({ error: 'Proposed price is required' }).positive(),
    estimatedDays: z.number().int().min(1).optional()
});
