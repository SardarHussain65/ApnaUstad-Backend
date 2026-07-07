import mongoose from 'mongoose';
import PlatformSettings, { UrgentPricingRate } from '../models/PlatformSettings';
import {
  URGENT_PRICING_RATES,
  DEFAULT_URGENT_RATE,
} from '../data/urgentPricingRates';

export type PlatformSettingsPayload = {
  urgentPricingRates: Record<string, UrgentPricingRate>;
  defaultUrgentRate: UrgentPricingRate;
  instantJobInitialRadiusKm: number;
  instantJobExpandedRadiusKm: number;
  instantJobExpansionMinutes: number;
  instantJobTimeoutMinutes: number;
  updatedAt?: Date;
};

const getFallbackSettings = (): PlatformSettingsPayload => ({
  urgentPricingRates: { ...URGENT_PRICING_RATES },
  defaultUrgentRate: { ...DEFAULT_URGENT_RATE },
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
    urgentPricingRates: {
      ...fallback.urgentPricingRates,
      ...(settings.urgentPricingRates || {}),
    },
    defaultUrgentRate: settings.defaultUrgentRate || fallback.defaultUrgentRate,
    instantJobInitialRadiusKm: Number(settings.instantJobInitialRadiusKm ?? fallback.instantJobInitialRadiusKm),
    instantJobExpandedRadiusKm: Number(settings.instantJobExpandedRadiusKm ?? fallback.instantJobExpandedRadiusKm),
    instantJobExpansionMinutes: Number(settings.instantJobExpansionMinutes ?? fallback.instantJobExpansionMinutes),
    instantJobTimeoutMinutes: Number(settings.instantJobTimeoutMinutes ?? fallback.instantJobTimeoutMinutes),
    updatedAt: settings.updatedAt,
  };
};

export const getUrgentRateForCategory = async (category: string): Promise<UrgentPricingRate> => {
  const settings = await getPlatformSettings();
  const keys = Object.keys(settings.urgentPricingRates);
  const matchedKey = keys.find((key) => key.toLowerCase() === category.toLowerCase());
  if (matchedKey) {
    const rate = settings.urgentPricingRates[matchedKey];
    if (rate) return rate;
  }
  return settings.defaultUrgentRate;
};

export const updatePlatformSettings = async ({
  urgentPricingRates,
  defaultUrgentRate,
  instantJobInitialRadiusKm,
  instantJobExpandedRadiusKm,
  instantJobExpansionMinutes,
  instantJobTimeoutMinutes,
  adminId,
}: {
  urgentPricingRates?: Record<string, UrgentPricingRate>;
  defaultUrgentRate?: UrgentPricingRate;
  instantJobInitialRadiusKm?: number;
  instantJobExpandedRadiusKm?: number;
  instantJobExpansionMinutes?: number;
  instantJobTimeoutMinutes?: number;
  adminId?: string | mongoose.Types.ObjectId;
}) => {
  const current = await getPlatformSettings();
  const next = {
    urgentPricingRates: urgentPricingRates ?? current.urgentPricingRates,
    defaultUrgentRate: defaultUrgentRate ?? current.defaultUrgentRate,
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
