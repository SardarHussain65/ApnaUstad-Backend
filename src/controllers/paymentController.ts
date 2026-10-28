import { Response } from "express";
import mongoose from "mongoose";
import Payment from "../models/Payment";
import { AuthRequest } from "../middlewares/jwt.middleware";
import logger from "../config/logger";

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

        if (!actorId || !actorType || !['user', 'worker'].includes(actorType)) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const isWorker = actorType === 'worker';
        const baseMatch = isWorker
            ? { worker: new mongoose.Types.ObjectId(actorId) }
            : { customer: new mongoose.Types.ObjectId(actorId) };
        const query: any = isWorker ? { worker: actorId } : { customer: actorId };
        if (status) {
            query.status = { $in: status.split(',').map(s => s.trim()) };
        }

        const amountField = isWorker ? '$workerEarning' : '$amount';

        const [payments, total, summaryAgg] = await Promise.all([
            Payment.find(query)
                .select('_id status amount workerEarning booking customer worker createdAt updatedAt')
                .populate('booking', 'category description status bookingType scheduledDate scheduledTime address paymentStatus')
                .populate('customer', 'fullName phone profileImage')
                .populate('worker', 'fullName phone profileImage')
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Payment.countDocuments(query),
            Payment.aggregate([
                { $match: baseMatch },
                {
                    $group: {
                        _id: null,
                        total: { $sum: { $ifNull: [amountField, 0] } },
                        paid: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, { $ifNull: [amountField, 0] }, 0] } },
                        payable: { $sum: { $cond: [{ $eq: ['$status', 'payable'] }, { $ifNull: [amountField, 0] }, 0] } },
                        pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, { $ifNull: [amountField, 0] }, 0] } },
                        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, { $ifNull: [amountField, 0] }, 0] } },
                    },
                },
            ]),
        ]);

        const aggRow = summaryAgg[0];
        const summary = {
            total: Number(aggRow?.total || 0),
            paid: Number(aggRow?.paid || 0),
            payable: Number(aggRow?.payable || 0),
            pending: Number(aggRow?.pending || 0),
            cancelled: Number(aggRow?.cancelled || 0),
            currency: 'PKR',
        };

        res.status(200).json({
            success: true,
            data: {
                payments,
                summary,
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
