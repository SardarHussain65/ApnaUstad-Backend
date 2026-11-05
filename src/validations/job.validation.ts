import { z } from 'zod';

const optionalUrlArray = z.array(z.string().url()).max(5).optional();

export const createJobPostSchema = z.object({
    category: z.string({ error: 'Please select a service category' }).trim().min(2).max(100),
    description: z.string({ error: 'Please describe the work needed' }).trim().min(10).max(1000),
    urgency: z.enum(['instant', 'scheduled']).default('scheduled'),
    scheduledDate: z.union([z.string(), z.date()]).optional(),
    scheduledTime: z.string().trim().optional(),
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
    address: z.string().trim().min(2).max(500),
    amount: z.number().min(0).default(0).optional(),
    pricingType: z.enum(['fixed', 'open']).default('fixed').optional(),
    imageUrl: z.string().url().optional(),
    imageUrls: optionalUrlArray,
    videoUrl: z.string().url().optional(),
    videoUrls: optionalUrlArray,
    audioUrls: z.array(z.string().url()).max(1).optional(),
    targetWorkerId: z.string().length(24).optional()
}).superRefine((data, ctx) => {
    const isFixed = data.pricingType === 'fixed' || (data.amount && data.amount > 0 && !data.pricingType);
    if (isFixed && (!data.amount || data.amount <= 0)) {
        ctx.addIssue({
            code: 'custom',
            path: ['amount'],
            message: 'Please enter a budget amount greater than zero'
        });
    }
    if (data.urgency === 'scheduled' && (!data.scheduledDate || !data.scheduledTime)) {
        ctx.addIssue({
            code: 'custom',
            path: ['scheduledDate'],
            message: 'Please choose a date and time for your scheduled visit'
        });
    }
});

export const submitJobBidSchema = z.object({
    message: z.string({ error: 'Please write a short note for the customer' }).trim().min(1).max(500),
    proposedPrice: z.number({ error: 'Please enter your rate' }).positive(),
    estimatedDays: z.number().int().min(1).optional(),
    rateBasis: z.enum(['total', 'per_day', 'per_hour']).default('total').optional(),
    helperCount: z.number().int().min(0).max(10).default(0).optional()
});
