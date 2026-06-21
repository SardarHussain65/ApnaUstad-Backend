import { z } from 'zod';

export const raiseDisputeSchema = z.object({
    bookingId: z.string().min(1),
    reason: z.enum(['incomplete_work', 'unfair_pricing', 'no_show', 'poor_quality', 'payment_issue', 'other']),
    description: z.string().trim().min(10).max(1000),
    proofImages: z.array(z.string().min(1)).max(5).optional().default([]),
});
