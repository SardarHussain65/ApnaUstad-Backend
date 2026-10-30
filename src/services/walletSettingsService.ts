import mongoose from 'mongoose';
import { getConfig } from '../config/env';
import WalletSettings from '../models/WalletSettings';

export type WalletSettingsPayload = {
    platformFeePercentage: number;
    minimumWalletBalance: number;
    additionalCategoryMonthlyFee: number;
    commissionEnabled: boolean;
    cnicVerificationBonus: number;
    updatedAt?: Date;
};

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getFallbackSettings = (): WalletSettingsPayload => ({
    platformFeePercentage: getConfig().platformFeePercentage || 10,
    minimumWalletBalance: getConfig().minimumWalletBalance || 500,
    additionalCategoryMonthlyFee: 500,
    commissionEnabled: true,
    cnicVerificationBonus: 500,
});

export const getWalletSettings = async (): Promise<WalletSettingsPayload> => {
    const fallback = getFallbackSettings();
    const settings = await WalletSettings.findOne({ key: 'default' }).lean();

    if (!settings) {
        return fallback;
    }

    return {
        platformFeePercentage: Number(settings.platformFeePercentage ?? fallback.platformFeePercentage),
        minimumWalletBalance: Number(settings.minimumWalletBalance ?? fallback.minimumWalletBalance),
        additionalCategoryMonthlyFee: Number(settings.additionalCategoryMonthlyFee ?? fallback.additionalCategoryMonthlyFee),
        commissionEnabled: settings.commissionEnabled !== false,
        cnicVerificationBonus: Number(settings.cnicVerificationBonus ?? fallback.cnicVerificationBonus),
        updatedAt: settings.updatedAt,
    };
};

export const updateWalletSettings = async ({
    platformFeePercentage,
    minimumWalletBalance,
    additionalCategoryMonthlyFee,
    commissionEnabled,
    cnicVerificationBonus,
    adminId,
}: {
    platformFeePercentage: number;
    minimumWalletBalance: number;
    additionalCategoryMonthlyFee?: number;
    commissionEnabled: boolean;
    cnicVerificationBonus?: number;
    adminId?: string | mongoose.Types.ObjectId;
}) => {
    const nextPlatformFeePercentage = clampNumber(Number(platformFeePercentage), 0, 100);
    const nextMinimumWalletBalance = Math.max(0, Number(minimumWalletBalance));
    const fallback = getFallbackSettings();
    const currentSettings = (additionalCategoryMonthlyFee === undefined || cnicVerificationBonus === undefined)
        ? await WalletSettings.findOne({ key: 'default' }).lean()
        : null;
    const nextAdditionalCategoryMonthlyFee = Math.max(0, Number(
        additionalCategoryMonthlyFee
        ?? currentSettings?.additionalCategoryMonthlyFee
        ?? fallback.additionalCategoryMonthlyFee
    ));
    const nextCnicVerificationBonus = Math.max(0, Number(
        cnicVerificationBonus
        ?? currentSettings?.cnicVerificationBonus
        ?? fallback.cnicVerificationBonus
    ));

    if (!Number.isFinite(nextPlatformFeePercentage)) {
        const error = new Error('Commission percentage must be a valid number.');
        (error as any).statusCode = 400;
        throw error;
    }

    if (!Number.isFinite(nextMinimumWalletBalance)) {
        const error = new Error('Minimum wallet balance must be a valid number.');
        (error as any).statusCode = 400;
        throw error;
    }

    if (!Number.isFinite(nextAdditionalCategoryMonthlyFee)) {
        const error = new Error('Additional category monthly fee must be a valid number.');
        (error as any).statusCode = 400;
        throw error;
    }

    const settings = await WalletSettings.findOneAndUpdate(
        { key: 'default' },
        {
            $set: {
                platformFeePercentage: nextPlatformFeePercentage,
                minimumWalletBalance: nextMinimumWalletBalance,
                additionalCategoryMonthlyFee: nextAdditionalCategoryMonthlyFee,
                commissionEnabled: commissionEnabled !== false,
                cnicVerificationBonus: nextCnicVerificationBonus,
                updatedBy: adminId ? new mongoose.Types.ObjectId(adminId) : null,
            }
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return {
        platformFeePercentage: Number(settings.platformFeePercentage),
        minimumWalletBalance: Number(settings.minimumWalletBalance),
        additionalCategoryMonthlyFee: Number(settings.additionalCategoryMonthlyFee),
        commissionEnabled: settings.commissionEnabled !== false,
        cnicVerificationBonus: Number(settings.cnicVerificationBonus ?? fallback.cnicVerificationBonus),
        updatedAt: settings.updatedAt,
    };
};
