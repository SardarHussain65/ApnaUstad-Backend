import mongoose from 'mongoose';
import PlatformSettings from '../models/PlatformSettings';

export type PlatformSettingsPayload = {
  instantJobInitialRadiusKm: number;
  instantJobExpandedRadiusKm: number;
  instantJobExpansionMinutes: number;
  instantJobTimeoutMinutes: number;
  updatedAt?: Date;
};

const getFallbackSettings = (): PlatformSettingsPayload => ({
  instantJobInitialRadiusKm: 10,
  instantJobExpandedRadiusKm: 25,
  instantJobExpansionMinutes: 5,
  instantJobTimeoutMinutes: 10,
});

export const getPlatformSettings = async (): Promise<PlatformSettingsPayload> => {
  const fallback = getFallbackSettings();
  const settings = await PlatformSettings.findOne({ key: 'default' }).lean();

  if (!settings) {
    return fallback;
  }

  return {
    instantJobInitialRadiusKm: Number(settings.instantJobInitialRadiusKm ?? fallback.instantJobInitialRadiusKm),
    instantJobExpandedRadiusKm: Number(settings.instantJobExpandedRadiusKm ?? fallback.instantJobExpandedRadiusKm),
    instantJobExpansionMinutes: Number(settings.instantJobExpansionMinutes ?? fallback.instantJobExpansionMinutes),
    instantJobTimeoutMinutes: Number(settings.instantJobTimeoutMinutes ?? fallback.instantJobTimeoutMinutes),
    updatedAt: settings.updatedAt,
  };
};

export const updatePlatformSettings = async ({
  instantJobInitialRadiusKm,
  instantJobExpandedRadiusKm,
  instantJobExpansionMinutes,
  instantJobTimeoutMinutes,
  adminId,
}: {
  instantJobInitialRadiusKm?: number;
  instantJobExpandedRadiusKm?: number;
  instantJobExpansionMinutes?: number;
  instantJobTimeoutMinutes?: number;
  adminId?: string | mongoose.Types.ObjectId;
}) => {
  const current = await getPlatformSettings();
  const next = {
    instantJobInitialRadiusKm: Math.max(1, Number(instantJobInitialRadiusKm ?? current.instantJobInitialRadiusKm)),
    instantJobExpandedRadiusKm: Math.max(1, Number(instantJobExpandedRadiusKm ?? current.instantJobExpandedRadiusKm)),
    instantJobExpansionMinutes: Math.max(1, Number(instantJobExpansionMinutes ?? current.instantJobExpansionMinutes)),
    instantJobTimeoutMinutes: Math.max(1, Number(instantJobTimeoutMinutes ?? current.instantJobTimeoutMinutes)),
    updatedBy: adminId ? new mongoose.Types.ObjectId(adminId) : null,
  };

  const settings = await PlatformSettings.findOneAndUpdate(
    { key: 'default' },
    { $set: next },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  return getPlatformSettings().then((payload) => ({
    ...payload,
    updatedAt: settings?.updatedAt,
  }));
};
