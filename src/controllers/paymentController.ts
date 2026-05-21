import { Response } from "express";
import Payment from "../models/Payment";
import { AuthRequest } from "../middlewares/jwt.middleware";
import logger from "../config/logger";

const buildSummary = (payments: any[], role: string | undefined) => {
    const isWorker = role === 'worker';
    return payments.reduce((summary, payment) => {
        const amount = isWorker ? Number(payment.workerEarning || 0) : Number(payment.amount || 0);
        summary.total += amount;
        if (payment.status === 'paid') summary.paid += amount;
        if (payment.status === 'payable') summary.payable += amount;
        if (payment.status === 'pending') summary.pending += amount;
        if (payment.status === 'cancelled') summary.cancelled += amount;
        return summary;
    }, {
        total: 0,
        paid: 0,
        payable: 0,
        pending: 0,
        cancelled: 0,
        currency: 'PKR',
    });
};

/**
 * @description Get payment history for the authenticated user or worker
 * @route GET /api/v1/payments/my-payments
 * @access Private (User or Worker)
 */
export const getMyPayments = async (req: AuthRequest, res: Response) => {
    try {
        const actorId = req.tokenPayload?.id;
        const actorType = req.tokenPayload?.type;
        const status = req.query.status as string | undefined;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;

        if (!actorId || !['user', 'worker'].includes(actorType)) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const query: any = actorType === 'worker' ? { worker: actorId } : { customer: actorId };
        if (status) {
            query.status = { $in: status.split(',').map(s => s.trim()) };
        }

        const [payments, total, allForSummary] = await Promise.all([
            Payment.find(query)
                .populate('booking', 'category description status bookingType scheduledDate scheduledTime address paymentStatus')
                .populate('customer', 'fullName phone profileImage')
                .populate('worker', 'fullName phone profileImage')
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit),
            Payment.countDocuments(query),
            Payment.find(actorType === 'worker' ? { worker: actorId } : { customer: actorId }).select('status amount workerEarning')
        ]);

        res.status(200).json({
            success: true,
            data: {
                payments,
                summary: buildSummary(allForSummary, actorType),
                pagination: {
                    total,
                    page,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error: any) {
        logger.error("Error in getMyPayments:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};
