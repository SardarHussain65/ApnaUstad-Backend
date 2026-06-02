import { Response } from 'express';
import { AdminAuthRequest } from '../middlewares/admin.middleware';
import {
    getConfiguredPaymentMethods,
    updateConfiguredPaymentMethods,
} from '../services/walletTopUpService';
import logger from '../config/logger';

export const getWalletPaymentMethods = async (_req: AdminAuthRequest, res: Response) => {
    try {
        const methods = await getConfiguredPaymentMethods({ includeDisabled: true });

        return res.status(200).json({
            success: true,
            data: methods,
            message: 'Wallet payment methods fetched successfully',
        });
    } catch (error: any) {
        logger.error('Error in getWalletPaymentMethods controller:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

export const updateWalletPaymentMethods = async (req: AdminAuthRequest, res: Response) => {
    try {
        const methods = req.body?.methods;

        if (!Array.isArray(methods) || methods.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'At least one payment method is required.',
            });
        }

        const updatedMethods = await updateConfiguredPaymentMethods({
            methods,
            ...(req.admin?._id ? { adminId: req.admin._id } : {}),
        });

        return res.status(200).json({
            success: true,
            data: updatedMethods,
            message: 'Wallet payment methods updated successfully',
        });
    } catch (error: any) {
        logger.error('Error in updateWalletPaymentMethods controller:', error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Internal server error',
        });
    }
};
