import Payment from "../models/Payment";
import { asyncHandler } from "../utils/asyncHandler";
import { paginatedResponse, successResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";

/**
 * Get payment ledger
 * @route GET /api/v1/admin/payments
 */
export const getAllPayments = asyncHandler(async (req: AdminAuthRequest, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const status = req.query.status as string;
    const workerId = req.query.workerId as string;
    const customerId = req.query.customerId as string;

    const query: any = {};
    if (status && status !== 'undefined') query.status = status;
    if (workerId && workerId !== 'undefined') query.worker = workerId;
    if (customerId && customerId !== 'undefined') query.customer = customerId;

    const total = await Payment.countDocuments(query);
    const payments = await Payment.find(query)
        .populate('booking', 'category status bookingType scheduledDate scheduledTime paymentStatus')
        .populate('customer', 'fullName phone')
        .populate('worker', 'fullName phone')
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

    return paginatedResponse(res, 200, "Payments fetched successfully", payments, page, limit, total);
});

/**
 * Get payment summary
 * @route GET /api/v1/admin/payments/summary
 */
export const getPaymentSummary = asyncHandler(async (_req: AdminAuthRequest, res) => {
    const rows = await Payment.aggregate([
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalAmount: { $sum: '$amount' },
                workerEarnings: { $sum: '$workerEarning' },
                platformFees: { $sum: '$platformFee' }
            }
        }
    ]);

    const summary = rows.reduce((acc: any, row: any) => {
        acc[row._id] = {
            count: row.count,
            totalAmount: row.totalAmount,
            workerEarnings: row.workerEarnings,
            platformFees: row.platformFees,
        };
        return acc;
    }, {});

    return successResponse(res, 200, "Payment summary fetched successfully", summary);
});
