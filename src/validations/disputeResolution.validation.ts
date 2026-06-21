import { z } from 'zod';

export const disputeModerationSchema = z.object({
    warnCustomer: z.boolean().optional().default(false),
    warnWorker: z.boolean().optional().default(false),
    workerPenalty: z.coerce.number().min(0).optional().default(0),
    blockCustomer: z.boolean().optional().default(false),
    blockWorker: z.boolean().optional().default(false),
    blockReason: z.string().trim().max(500).optional().default(''),
}).superRefine((data, ctx) => {
    if ((data.blockCustomer || data.blockWorker) && !data.blockReason) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Block reason is required when blocking an account',
            path: ['blockReason'],
        });
    }
});

export const resolveDisputeSchema = z.object({
    status: z.enum(['resolved', 'dismissed', 'under_review']),
    adminNotes: z.string().trim().max(1000).optional().default(''),
    resolutionDetails: z.string().trim().max(1000).optional().default(''),
    refundAmount: z.coerce.number().min(0).optional().default(0),
    moderation: disputeModerationSchema.optional().default({
        warnCustomer: false,
        warnWorker: false,
        workerPenalty: 0,
        blockCustomer: false,
        blockWorker: false,
        blockReason: '',
    }),
});
