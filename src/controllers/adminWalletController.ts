import WorkerWallet from "../models/WorkerWallet";
import Worker from "../models/Workers";
import WalletTransaction from "../models/WalletTransaction";
import WalletTopUpRequest from "../models/WalletTopUpRequest";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../utils/ApiError";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import * as walletService from "../services/workerWalletService";
import { getWalletSettings, updateWalletSettings } from "../services/walletSettingsService";
import mongoose from "mongoose";

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Get all worker wallets
 * @route GET /api/v1/admin/wallets
 */
export const getAllWorkerWallets = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { search, balanceStatus, page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 10, 100);
    const skip = (pageNum - 1) * limitNum;

    let query: any = {};

    // 1. Filter by search (name/phone/email)
    if (search) {
        const searchRegex = new RegExp(escapeRegex(search as string), 'i');
        const matchingWorkers = await Worker.find({
            $or: [
                { fullName: searchRegex },
                { phone: searchRegex },
                { email: searchRegex }
            ]
        }).select('_id');
        const workerIds = matchingWorkers.map(w => w._id);
        query.worker = { $in: workerIds };
    }

    // 2. Filter by balance status
    const walletSettings = await getWalletSettings();
    const minBalance = walletSettings.minimumWalletBalance;
    if (balanceStatus === 'low') {
        query.$expr = {
            $and: [
                { $lt: [{ $subtract: ['$balance', { $ifNull: ['$reservedBalance', 0] }] }, minBalance] },
                { $gt: [{ $subtract: ['$balance', { $ifNull: ['$reservedBalance', 0] }] }, 0] }
            ]
        };
    } else if (balanceStatus === 'zero') {
        query.$expr = { $lte: [{ $subtract: ['$balance', { $ifNull: ['$reservedBalance', 0] }] }, 0] };
    } else if (balanceStatus === 'sufficient') {
        query.$expr = { $gte: [{ $subtract: ['$balance', { $ifNull: ['$reservedBalance', 0] }] }, minBalance] };
    }

    const total = await WorkerWallet.countDocuments(query);
    const wallets = await WorkerWallet.find(query)
        .populate('worker', 'fullName phone email profileImage')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNum);

    const rows = wallets.map(wallet => ({
        ...wallet.toObject(),
        availableBalance: Number(wallet.balance || 0) - Number(wallet.reservedBalance || 0)
    }));

    return paginatedResponse(res, 200, "Worker wallets fetched successfully", rows, pageNum, limitNum, total);
});

/**
 * Get wallet overview summary
 * @route GET /api/v1/admin/wallets/summary
 */
export const getWalletSummary = asyncHandler(async (_req: AdminAuthRequest, res) => {
    const walletSettings = await getWalletSettings();
    const minBalance = walletSettings.minimumWalletBalance;
    const [walletTotals, lowBalanceCount, zeroBalanceCount, pendingTopUps] = await Promise.all([
        WorkerWallet.aggregate([
            {
                $group: {
                    _id: null,
                    totalBalance: { $sum: '$balance' },
                    totalReservedBalance: { $sum: { $ifNull: ['$reservedBalance', 0] } },
                    totalAvailableBalance: {
                        $sum: { $subtract: ['$balance', { $ifNull: ['$reservedBalance', 0] }] }
                    },
                    totalRecharged: { $sum: '$totalRecharged' },
                    totalCommissionDeducted: { $sum: '$totalCommissionDeducted' },
                    walletCount: { $sum: 1 }
                }
            }
        ]),
        WorkerWallet.countDocuments({
            $expr: {
                $and: [
                    { $lt: [{ $subtract: ['$balance', { $ifNull: ['$reservedBalance', 0] }] }, minBalance] },
                    { $gt: [{ $subtract: ['$balance', { $ifNull: ['$reservedBalance', 0] }] }, 0] }
                ]
            }
        }),
        WorkerWallet.countDocuments({
            $expr: { $lte: [{ $subtract: ['$balance', { $ifNull: ['$reservedBalance', 0] }] }, 0] }
        }),
        WalletTopUpRequest.aggregate([
            { $match: { status: 'pending' } },
            {
                $group: {
                    _id: null,
                    count: { $sum: 1 },
                    amount: { $sum: '$amount' }
                }
            }
        ])
    ]);

    const totals = walletTotals[0] || {};
    const pending = pendingTopUps[0] || {};

    return successResponse(res, 200, "Wallet summary fetched successfully", {
        walletCount: totals.walletCount || 0,
        totalBalance: totals.totalBalance || 0,
        totalReservedBalance: totals.totalReservedBalance || 0,
        totalAvailableBalance: totals.totalAvailableBalance || 0,
        totalRecharged: totals.totalRecharged || 0,
        totalCommissionDeducted: totals.totalCommissionDeducted || 0,
        lowBalanceCount,
        zeroBalanceCount,
        minimumWalletBalance: minBalance,
        pendingTopUpCount: pending.count || 0,
        pendingTopUpAmount: pending.amount || 0,
        commissionSettings: walletSettings
    });
});

/**
 * Get wallet commission and eligibility settings
 * @route GET /api/v1/admin/wallet-settings
 */
export const getWalletSettingsController = asyncHandler(async (_req: AdminAuthRequest, res) => {
    const settings = await getWalletSettings();
    return successResponse(res, 200, "Wallet settings fetched successfully", settings);
});

/**
 * Update wallet commission and eligibility settings
 * @route PATCH /api/v1/admin/wallet-settings
 */
export const updateWalletSettingsController = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { platformFeePercentage, minimumWalletBalance, additionalCategoryMonthlyFee, commissionEnabled = true } = req.body;

    if (platformFeePercentage === undefined || minimumWalletBalance === undefined) {
        throw new BadRequestError("Commission percentage and minimum wallet balance are required");
    }

    const settings = await updateWalletSettings({
        platformFeePercentage: Number(platformFeePercentage),
        minimumWalletBalance: Number(minimumWalletBalance),
        ...(additionalCategoryMonthlyFee !== undefined ? { additionalCategoryMonthlyFee: Number(additionalCategoryMonthlyFee) } : {}),
        commissionEnabled: commissionEnabled !== false,
        ...(req.admin?._id ? { adminId: req.admin._id } : {}),
    });

    return successResponse(res, 200, "Wallet settings updated successfully", settings);
});

/**
 * Get a specific worker's wallet and paginated transaction history
 * @route GET /api/v1/admin/wallets/:workerId
 */
export const getWorkerWalletDetails = asyncHandler(async (req: AdminAuthRequest, res) => {
    const workerId = req.params.workerId as string;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;

    const worker = await Worker.findById(workerId).select('fullName phone email profileImage');
    if (!worker) {
        throw new NotFoundError("Worker not found");
    }

    const wallet = await walletService.getOrCreateWallet(workerId);
    const transactionsResult = await walletService.getTransactionHistory(workerId, page, limit);

    return successResponse(res, 200, "Worker wallet details fetched successfully", {
        worker,
        wallet: {
            ...wallet.toObject(),
            availableBalance: Number(wallet.balance || 0) - Number(wallet.reservedBalance || 0)
        },
        transactions: transactionsResult.transactions,
        pagination: {
            total: transactionsResult.total,
            page: transactionsResult.page,
            limit: transactionsResult.limit,
            totalPages: transactionsResult.totalPages
        }
    });
});

/**
 * Admin recharge a worker's wallet
 * @route POST /api/v1/admin/wallets/:workerId/recharge
 */
export const rechargeWorkerWallet = asyncHandler(async (req: AdminAuthRequest, res) => {
    const workerId = req.params.workerId as string;
    const { amount, description } = req.body;
    const adminId = req.admin?._id;

    if (!amount || amount <= 0) {
        throw new BadRequestError("Amount must be a positive number");
    }

    const worker = await Worker.findById(workerId);
    if (!worker) {
        throw new NotFoundError("Worker not found");
    }

    const adminActorId = adminId || new mongoose.Types.ObjectId();
    
    const wallet = await walletService.rechargeWallet(
        workerId,
        amount,
        { actor: adminActorId, actorType: 'admin' },
        description || 'Recharge credited by Admin'
    );

    return successResponse(res, 200, "Worker wallet recharged successfully", wallet);
});

/**
 * Admin adjust a worker's wallet balance (Refund or manual adjustment)
 * @route POST /api/v1/admin/wallets/:workerId/adjust
 */
export const adjustWorkerWallet = asyncHandler(async (req: AdminAuthRequest, res) => {
    const workerId = req.params.workerId as string;
    const { amount, type, description } = req.body;
    const adminId = req.admin?._id;

    if (amount === undefined || amount === 0) {
        throw new BadRequestError("Amount must be a non-zero number");
    }

    if (!type || !['refund', 'adjustment'].includes(type)) {
        throw new BadRequestError("Type must be 'refund' or 'adjustment'");
    }

    if (!description || description.trim() === '') {
        throw new BadRequestError("Adjustment description is required");
    }

    const worker = await Worker.findById(workerId);
    if (!worker) {
        throw new NotFoundError("Worker not found");
    }

    const wallet = await walletService.getOrCreateWallet(workerId);
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore + amount;

    // Apply adjustments
    wallet.balance = balanceAfter;
    if (amount > 0) {
        if (type === 'refund') {
            wallet.totalCommissionDeducted = Math.max(0, wallet.totalCommissionDeducted - amount);
        } else {
            wallet.totalRecharged += amount;
        }
    } else {
        wallet.totalCommissionDeducted += Math.abs(amount);
    }
    
    await wallet.save();

    const adminActorId = adminId || new mongoose.Types.ObjectId();

    await WalletTransaction.create({
        wallet: wallet._id,
        worker: workerId,
        type,
        amount: Math.abs(amount),
        balanceBefore,
        balanceAfter,
        description: `Admin manual adjustment (${amount > 0 ? '+' : ''}${amount}): ${description}`,
        performedBy: {
            actor: adminActorId,
            actorType: 'admin'
        }
    });

    return successResponse(res, 200, "Worker wallet balance adjusted successfully", wallet);
});
