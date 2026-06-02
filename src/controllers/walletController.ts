import { Response } from "express";
import { AuthRequest } from "../middlewares/jwt.middleware";
import { UploadRequest } from "../middlewares/multer.middleware";
import * as walletService from "../services/workerWalletService";
import WalletTopUpRequest, { WalletTopUpMethod } from "../models/WalletTopUpRequest";
import {
    createWalletTopUpRequest,
    getConfiguredPaymentMethods
} from "../services/walletTopUpService";
import { getWalletSettings } from "../services/walletSettingsService";
import logger from "../config/logger";

/**
 * @description Get my wallet details (Worker only)
 * @route GET /api/v1/wallet/my-wallet
 * @access Private (Worker)
 */
export const getMyWallet = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        const actorType = req.tokenPayload?.type;

        if (!workerId || actorType !== 'worker') {
            return res.status(401).json({ success: false, message: "Unauthorized. Worker access only." });
        }

        const wallet = await walletService.getOrCreateWallet(workerId);
        const requiredBalance = await walletService.getRequiredWalletBalance();
        const walletSettings = await getWalletSettings();
        const reservedBalance = Number(wallet.reservedBalance || 0);
        const availableBalance = Number(wallet.balance || 0) - reservedBalance;

        return res.status(200).json({
            success: true,
            data: {
                ...wallet.toObject(),
                reservedBalance,
                availableBalance,
                requiredBalance,
                platformFeePercentage: walletSettings.platformFeePercentage,
                commissionEnabled: walletSettings.commissionEnabled,
                isEligibleForNewJobs: wallet.isActive && availableBalance >= requiredBalance
            }
        });
    } catch (error: any) {
        logger.error("Error in getMyWallet controller:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get transaction history (Worker only)
 * @route GET /api/v1/wallet/transactions
 * @access Private (Worker)
 */
export const getTransactions = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        const actorType = req.tokenPayload?.type;

        if (!workerId || actorType !== 'worker') {
            return res.status(401).json({ success: false, message: "Unauthorized. Worker access only." });
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;

        const result = await walletService.getTransactionHistory(workerId, page, limit);

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error: any) {
        logger.error("Error in getTransactions controller:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get configured manual payment methods for wallet top-up
 * @route GET /api/v1/wallet/payment-methods
 * @access Private (Worker)
 */
export const getPaymentMethods = async (req: AuthRequest, res: Response) => {
    try {
        const actorType = req.tokenPayload?.type;
        if (actorType !== 'worker') {
            return res.status(401).json({ success: false, message: "Unauthorized. Worker access only." });
        }

        const methods = await getConfiguredPaymentMethods();
        return res.status(200).json({
            success: true,
            data: methods,
            message: methods.length ? "Payment methods fetched successfully" : "No wallet payment methods are configured yet"
        });
    } catch (error: any) {
        logger.error("Error in getPaymentMethods controller:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Create a manual wallet top-up request with proof
 * @route POST /api/v1/wallet/topups
 * @access Private (Worker)
 */
export const createTopUpRequest = async (req: UploadRequest & AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        const actorType = req.tokenPayload?.type;

        if (!workerId || actorType !== 'worker') {
            return res.status(401).json({ success: false, message: "Unauthorized. Worker access only." });
        }

        const amount = Number(req.body.amount);
        const method = req.body.method as WalletTopUpMethod;

        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: "Amount must be a positive number." });
        }

        if (!method) {
            return res.status(400).json({ success: false, message: "Payment method is required." });
        }

        if (!req.uploadedImageUrl) {
            return res.status(400).json({ success: false, message: "Payment proof screenshot is required." });
        }

        const topUpRequest = await createWalletTopUpRequest({
            workerId,
            amount,
            method,
            proofImageUrl: req.uploadedImageUrl
        });

        return res.status(201).json({
            success: true,
            message: "Your payment proof has been submitted successfully. Please wait while our admin verifies your payment.",
            data: topUpRequest
        });
    } catch (error: any) {
        logger.error("Error in createTopUpRequest controller:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Internal server error"
        });
    }
};

/**
 * @description Get wallet top-up requests for authenticated worker
 * @route GET /api/v1/wallet/topups
 * @access Private (Worker)
 */
export const getMyTopUpRequests = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        const actorType = req.tokenPayload?.type;

        if (!workerId || actorType !== 'worker') {
            return res.status(401).json({ success: false, message: "Unauthorized. Worker access only." });
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const status = req.query.status as string | undefined;
        const query: any = { worker: workerId };
        if (status) {
            query.status = { $in: status.split(',').map(s => s.trim()) };
        }

        const [requests, total] = await Promise.all([
            WalletTopUpRequest.find(query)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit),
            WalletTopUpRequest.countDocuments(query)
        ]);

        return res.status(200).json({
            success: true,
            data: {
                requests,
                pagination: {
                    total,
                    page,
                    pages: Math.ceil(total / limit)
                }
            }
        });
    } catch (error: any) {
        logger.error("Error in getMyTopUpRequests controller:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Deprecated worker self-recharge endpoint
 * @route POST /api/v1/wallet/recharge
 * @access Private (Worker)
 */
export const rechargeMyWallet = async (req: AuthRequest, res: Response) => {
    return res.status(410).json({
        success: false,
        message: "Direct wallet recharge is no longer available. Please submit a top-up request with payment proof."
    });
};
