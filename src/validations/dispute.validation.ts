import { z } from 'zod';

export const raiseDisputeSchema = z.object({
    bookingId: z.string().min(1),
    reason: z.enum(['incomplete_work', 'unfair_pricing', 'no_show', 'poor_quality', 'payment_issue', 'other']),
    description: z.string().trim().min(10).max(1000),
    proofImages: z.array(z.string().min(1)).max(5).optional().default([]),
});

export const disputeMessageSchema = z.object({
    content: z.string().trim().max(1000).optional().default(''),
    attachments: z.array(z.string().url().startsWith('https://')).max(3).optional().default([]),
    replyTo: z.string().trim().optional().nullable(),
}).refine((data) => data.content.length > 0 || data.attachments.length > 0, {
    message: 'Write a message or attach a photo',
});

export const withdrawDisputeSchema = z.object({
    note: z.string().trim().max(500).optional().default(''),
});
