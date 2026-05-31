import mongoose from "mongoose";
import WalletTopUpRequest from "../models/WalletTopUpRequest";
import Worker from "../models/Workers";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../utils/ApiError";
import { paginatedResponse, successResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import {
    approveWalletTopUpRequest,
    buildTopUpSummary,
    rejectWalletTopUpRequest
} from "../services/walletTopUpService";

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildTopUpQuery = async (req: AdminAuthRequest) => {
    const { status, method, workerId, search, dateFrom, dateTo } = req.query;
    const query: any = {};

    if (status && status !== 'all') {
        query.status = status;
    }
    if (method && method !== 'all') {
        query.method = method;
    }
    if (workerId) {
        query.worker = workerId;
    }
    if (search) {
        const searchRegex = new RegExp(escapeRegex(search as string), 'i');
        const matchingWorkers = await Worker.find({
            $or: [
                { fullName: searchRegex },
                { phone: searchRegex },
                { email: searchRegex },
            ]
        }).select('_id');
        query.worker = { $in: matchingWorkers.map((worker) => worker._id) };
    }
    if (dateFrom || dateTo) {
        query.createdAt = {};
        if (dateFrom) query.createdAt.$gte = new Date(dateFrom as string);
        if (dateTo) {
            const end = new Date(dateTo as string);
            end.setHours(23, 59, 59, 999);
            query.createdAt.$lte = end;
        }
    }

    return query;
};

/**
 * Get all wallet top-up requests
 * @route GET /api/v1/admin/wallet-topups
 */
export const getAllWalletTopUps = asyncHandler(async (req: AdminAuthRequest, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const query = await buildTopUpQuery(req);

    const [total, requests] = await Promise.all([
        WalletTopUpRequest.countDocuments(query),
        WalletTopUpRequest.find(query)
            .populate('worker', 'fullName phone email profileImage category')
            .populate('admin', 'fullName email')
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
    ]);

    return paginatedResponse(res, 200, "Wallet top-up requests fetched successfully", requests, page, limit, total);
});

/**
 * Get wallet top-up request detail
 * @route GET /api/v1/admin/wallet-topups/:id
 */
export const getWalletTopUpDetails = asyncHandler(async (req: AdminAuthRequest, res) => {
    const request = await WalletTopUpRequest.findById(req.params.id)
        .populate('worker', 'fullName phone email profileImage category city address')
        .populate('admin', 'fullName email');

    if (!request) {
        throw new NotFoundError("Wallet top-up request not found");
    }

    return successResponse(res, 200, "Wallet top-up request fetched successfully", request);
});

/**
 * Approve top-up request and credit worker wallet
 * @route PATCH /api/v1/admin/wallet-topups/:id/approve
 */
export const approveWalletTopUp = asyncHandler(async (req: AdminAuthRequest, res) => {
    const adminId = req.admin?._id;
    if (!adminId) {
        throw new BadRequestError("Admin context is missing");
    }

    const { topUpRequest, wallet } = await approveWalletTopUpRequest({
        requestId: String(req.params.id || ''),
        adminId: adminId as mongoose.Types.ObjectId,
        adminNotes: req.body.adminNotes || ''
    });

    return successResponse(res, 200, "Wallet top-up approved and credited successfully", {
        topUpRequest,
        wallet
    });
});

/**
 * Reject top-up request
 * @route PATCH /api/v1/admin/wallet-topups/:id/reject
 */
export const rejectWalletTopUp = asyncHandler(async (req: AdminAuthRequest, res) => {
    const adminId = req.admin?._id;
    const { rejectionReason, adminNotes } = req.body;

    if (!adminId) {
        throw new BadRequestError("Admin context is missing");
    }
    if (!rejectionReason || !String(rejectionReason).trim()) {
        throw new BadRequestError("Rejection reason is required");
    }

    const topUpRequest = await rejectWalletTopUpRequest({
        requestId: String(req.params.id || ''),
        adminId: adminId as mongoose.Types.ObjectId,
        rejectionReason: String(rejectionReason).trim(),
        adminNotes: adminNotes || ''
    });

    return successResponse(res, 200, "Wallet top-up request rejected successfully", topUpRequest);
});

/**
 * Get wallet top-up summary
 * @route GET /api/v1/admin/wallet-topups/summary
 */
export const getWalletTopUpSummary = asyncHandler(async (req: AdminAuthRequest, res) => {
    const query = await buildTopUpQuery(req);
    const summary = await buildTopUpSummary(query);
    return successResponse(res, 200, "Wallet top-up summary fetched successfully", summary);
});
