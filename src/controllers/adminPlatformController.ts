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
    instantJobInitialRadiusKm,
    instantJobExpandedRadiusKm,
    instantJobExpansionMinutes,
    instantJobTimeoutMinutes,
  } = req.body;

  const settings = await updatePlatformSettings({
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
