import { Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { successResponse } from '../utils/ApiResponse';
import { AdminAuthRequest } from '../middlewares/admin.middleware';
import { BadRequestError } from '../utils/ApiError';
import {
  getPlatformSettings,
  updatePlatformSettings,
} from '../services/platformSettingsService';
import { recordAdminAction } from '../services/adminAuditLog';

export const getPlatformSettingsController = asyncHandler(async (_req: AdminAuthRequest, res: Response) => {
  const settings = await getPlatformSettings();
  return successResponse(res, 200, 'Platform settings fetched successfully', settings);
});

export const updatePlatformSettingsController = asyncHandler(async (req: AdminAuthRequest, res: Response) => {
  const {
    urgentPricingRates,
    defaultUrgentRate,
    instantJobInitialRadiusKm,
    instantJobExpandedRadiusKm,
    instantJobExpansionMinutes,
    instantJobTimeoutMinutes,
  } = req.body;

  if (
    urgentPricingRates !== undefined
    && (typeof urgentPricingRates !== 'object' || Array.isArray(urgentPricingRates))
  ) {
    throw new BadRequestError('urgentPricingRates must be an object');
  }

  const settings = await updatePlatformSettings({
    urgentPricingRates,
    defaultUrgentRate,
    instantJobInitialRadiusKm,
    instantJobExpandedRadiusKm,
    instantJobExpansionMinutes,
    instantJobTimeoutMinutes,
    ...(req.admin?._id ? { adminId: req.admin._id } : {}),
  });

  await recordAdminAction(req, {
    action: 'platform.settings_update',
    entityType: 'platform',
    entityId: 'default',
    metadata: {
      instantJobInitialRadiusKm: settings.instantJobInitialRadiusKm,
      instantJobExpandedRadiusKm: settings.instantJobExpandedRadiusKm,
    },
  });

  return successResponse(res, 200, 'Platform settings updated successfully', settings);
});
