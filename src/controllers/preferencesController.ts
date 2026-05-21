import { Response } from 'express';
import UserPreferences from '../models/UserPreferences';
import { asyncHandler } from '../utils/asyncHandler';
import { successResponse } from '../utils/ApiResponse';
import { BadRequestError, ForbiddenError } from '../utils/ApiError';
import { AuthRequest } from '../middlewares/jwt.middleware';

const getActor = (req: AuthRequest) => {
  const userId = req.tokenPayload?.id;
  const userType = req.tokenPayload?.type;

  if (!userId || !['user', 'worker'].includes(userType)) {
    throw new ForbiddenError('Unauthorized');
  }

  return { userId, userType };
};

const applyBooleanPatch = (target: Record<string, any>, source: Record<string, any>, keys: string[]) => {
  keys.forEach((key) => {
    if (typeof source[key] === 'boolean') {
      target[key] = source[key];
    }
  });
};

export const getMyPreferences = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { userId, userType } = getActor(req);

  let preferences = await UserPreferences.findOne({ userId, userType });
  if (!preferences) {
    preferences = await UserPreferences.create({ userId, userType });
  }

  return successResponse(res, 200, 'Preferences fetched successfully', preferences);
});

export const updateMyPreferences = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { userId, userType } = getActor(req);
  const { notifications, security } = req.body || {};

  if (notifications && typeof notifications !== 'object') {
    throw new BadRequestError('Invalid notifications payload');
  }
  if (security && typeof security !== 'object') {
    throw new BadRequestError('Invalid security payload');
  }

  let preferences = await UserPreferences.findOne({ userId, userType });
  if (!preferences) {
    preferences = await UserPreferences.create({ userId, userType });
  }

  if (notifications) {
    applyBooleanPatch(preferences.notifications as any, notifications, [
      'pushEnabled',
      'emailEnabled',
      'jobAlerts',
      'messages',
      'promos',
    ]);
  }

  if (security) {
    applyBooleanPatch(preferences.security as any, security, [
      'twoFactorEnabled',
      'biometricsEnabled',
    ]);
  }

  await preferences.save();

  return successResponse(res, 200, 'Preferences updated successfully', preferences);
});
