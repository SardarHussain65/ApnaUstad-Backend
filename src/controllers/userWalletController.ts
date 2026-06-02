import { Response } from "express";
import { AuthRequest } from "../middlewares/jwt.middleware";
import * as userWalletService from "../services/userWalletService";
import logger from "../config/logger";

/**
 * @description Get my customer wallet balance and details
 * @route GET /api/v1/user-wallet/my
 * @access Private (User/Customer)
 */
export const getMyUserWallet = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.tokenPayload?.id;
        const actorType = req.tokenPayload?.type;

        if (!userId || actorType !== 'user') {
            return res.status(401).json({ success: false, message: "Unauthorized. Customer access only." });
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;

        const wallet = await userWalletService.getOrCreateUserWallet(userId);
        const transactionResult = await userWalletService.getCustomerTransactionHistory(userId, page, limit);

        return res.status(200).json({
            success: true,
            data: {
                wallet: {
                    _id: wallet._id,
                    user: wallet.user,
                    balance: wallet.balance,
                    isActive: wallet.isActive,
                    createdAt: wallet.createdAt,
                    updatedAt: wallet.updatedAt
                },
                transactions: transactionResult.transactions,
                pagination: {
                    total: transactionResult.total,
                    page: transactionResult.page,
                    limit: transactionResult.limit,
                    totalPages: transactionResult.totalPages
                }
            }
        });
    } catch (error: any) {
        logger.error("Error in getMyUserWallet controller:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
