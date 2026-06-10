import mongoose from 'mongoose';
import Category from '../models/Category';
import Worker, { IWorker } from '../models/Workers';
import { deductSpecialtySubscription, getOrCreateWallet } from './workerWalletService';
import { getWalletSettings } from './walletSettingsService';

export const MAX_WORKER_SPECIALTIES = 5;
export const FREE_SPECIALTY_LIMIT = 1;

export type SpecialtyProfileInput = {
    skills: string[];
    hourlyRate: number;
    experience: number;
    bio: string;
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toObjectId = (value: string | mongoose.Types.ObjectId) => (
    typeof value === 'string' ? new mongoose.Types.ObjectId(value) : value
);
const toId = (value: any) => value?.toString?.() || '';
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const addMonths = (date: Date, months: number) => {
    const next = new Date(date);
    next.setUTCMonth(next.getUTCMonth() + months);
    return next;
};

export const getSpecialtyTier = (priority: number) => {
    if (priority === 1) return 'primary';
    return 'additional';
};

const specialtyCanMatch = (specialty: any) => (
    specialty?.approvalStatus === 'approved'
    && specialty?.isActive === true
    && ['free', 'active', 'payment_due'].includes(specialty?.subscriptionStatus)
);

export const getAdditionalCategoryMonthlyFee = async () => {
    const settings = await getWalletSettings();
    return Math.max(0, Number(settings.additionalCategoryMonthlyFee ?? 500));
};

const ensureWalletCanRequestAdditionalCategory = async (workerId: string | mongoose.Types.ObjectId, monthlyFee: number) => {
    if (monthlyFee <= 0) return;
    const wallet = await getOrCreateWallet(workerId);
    const availableBalance = Number(wallet.balance || 0) - Number(wallet.reservedBalance || 0);
    if (!wallet.isActive || availableBalance < monthlyFee) {
        const error = new Error(`Please recharge your wallet before adding another category. Required balance: Rs. ${monthlyFee.toLocaleString('en-PK')}. Current balance: Rs. ${Math.max(0, availableBalance).toLocaleString('en-PK')}.`);
        (error as any).statusCode = 402;
        (error as any).requiredBalance = monthlyFee;
        (error as any).currentBalance = Math.max(0, availableBalance);
        throw error;
    }
};

const normalizeSkills = (skills: unknown) => (
    Array.isArray(skills)
        ? skills.map((skill) => String(skill || '').trim()).filter(Boolean).slice(0, 10)
        : []
);

export const normalizeSpecialtyProfileInput = (input: any): SpecialtyProfileInput => {
    const skills = normalizeSkills(input?.skills);
    const hourlyRate = Number(input?.hourlyRate);
    const experience = Number(input?.experience);
    const bio = String(input?.bio || '').trim();

    if (skills.length === 0) {
        throw Object.assign(new Error('At least one skill is required for this category'), { statusCode: 400 });
    }
    if (!Number.isFinite(hourlyRate) || hourlyRate < 100) {
        throw Object.assign(new Error('Hourly rate must be at least 100'), { statusCode: 400 });
    }
    if (!Number.isFinite(experience) || experience < 0) {
        throw Object.assign(new Error('Experience must be zero or more'), { statusCode: 400 });
    }
    if (bio.length < 3 || bio.length > 500) {
        throw Object.assign(new Error('Description must be between 3 and 500 characters'), { statusCode: 400 });
    }

    return {
        skills,
        hourlyRate,
        experience,
        bio
    };
};

const buildProfileFromWorker = (worker: IWorker): SpecialtyProfileInput => ({
    skills: normalizeSkills(worker.skills),
    hourlyRate: Math.max(0, Number(worker.hourlyRate || 0)),
    experience: Math.max(0, Number(worker.experience || 0)),
    bio: String(worker.bio || '').trim()
});

const applySpecialtyProfile = (specialty: any, profile: SpecialtyProfileInput) => {
    specialty.skills = profile.skills;
    specialty.hourlyRate = profile.hourlyRate;
    specialty.experience = profile.experience;
    specialty.bio = profile.bio;
};

const syncRootProfileFromPrimary = async (worker: IWorker) => {
    const primary = worker.specialties?.find((specialty: any) => specialty.priority === 1);
    if (!primary) return;

    const category = await Category.findById(primary.categoryId);
    const primaryProfile = buildSpecialtyProfileSnapshot(worker, primary, category);
    if (category) worker.category = category.name;
    worker.skills = primaryProfile.skills;
    worker.hourlyRate = primaryProfile.hourlyRate;
    worker.experience = primaryProfile.experience;
    worker.bio = primaryProfile.bio;
};

const buildSpecialtyProfileSnapshot = (worker: any, specialty: any, category?: any) => ({
    categoryId: toId(specialty?.categoryId?._id || specialty?.categoryId || category?._id),
    category: category?.name || specialty?.categoryId?.name || worker?.category || '',
    priority: Number(specialty?.priority || 1),
    tier: getSpecialtyTier(Number(specialty?.priority || 1)),
    skills: normalizeSkills(specialty?.skills?.length ? specialty.skills : worker?.skills),
    hourlyRate: Math.max(0, Number(specialty?.hourlyRate || worker?.hourlyRate || 0)),
    experience: Math.max(0, Number(specialty?.experience ?? worker?.experience ?? 0)),
    bio: String(specialty?.bio || worker?.bio || '')
});

export const resolveCategoryByName = async (categoryName: string, includeInactive = false) => {
    if (!categoryName?.trim()) return null;
    return Category.findOne({
        name: new RegExp(`^${escapeRegex(categoryName.trim())}$`, 'i'),
        ...(includeInactive ? {} : { isActive: true })
    });
};

export const ensureLegacyPrimarySpecialty = async (worker: IWorker) => {
    if (worker.specialties?.length || !worker.category) return worker;

    const category = await resolveCategoryByName(worker.category, true);
    if (!category) return worker;

    const isApproved = worker.isVerified === true;
    (worker.specialties as any).push({
        categoryId: category._id,
        priority: 1,
        ...buildProfileFromWorker(worker),
        isActive: isApproved,
        approvalStatus: isApproved ? 'approved' : 'pending',
        subscriptionStatus: 'free',
        monthlyFeeSnapshot: 0,
        autoRenew: true,
        requestedAt: worker.createdAt || new Date(),
        approvedAt: isApproved ? new Date() : null
    });
    worker.category = category.name;
    await worker.save();
    return worker;
};

export const createPrimarySpecialtyFromLegacyCategory = async ({
    categoryName,
    profile,
    isApproved = false,
}: {
    categoryName: string;
    profile: SpecialtyProfileInput;
    isApproved?: boolean;
}) => {
    const category = await resolveCategoryByName(categoryName);
    if (!category) throw Object.assign(new Error('Category is not available'), { statusCode: 400 });

    return [{
        categoryId: category._id,
        priority: 1,
        ...profile,
        isActive: isApproved,
        approvalStatus: isApproved ? 'approved' : 'pending',
        subscriptionStatus: 'free',
        monthlyFeeSnapshot: 0,
        autoRenew: true
    }];
};

const syncLegacyCategory = async (worker: IWorker) => {
    await syncRootProfileFromPrimary(worker);
};

const recalculateSubscriptionStates = async (worker: IWorker) => {
    const additionalCategoryMonthlyFee = await getAdditionalCategoryMonthlyFee();

    worker.specialties.forEach((specialty: any) => {
        const monthlyFee = specialty.priority <= FREE_SPECIALTY_LIMIT ? 0 : additionalCategoryMonthlyFee;
        if (specialty.approvalStatus !== 'approved') {
            specialty.isActive = false;
            return;
        }

        if (specialty.priority <= FREE_SPECIALTY_LIMIT || monthlyFee === 0) {
            specialty.subscriptionStatus = 'free';
            specialty.monthlyFeeSnapshot = 0;
            specialty.isActive = true;
            specialty.currentPeriodStart = null;
            specialty.currentPeriodEnd = null;
            specialty.nextBillingAt = null;
            specialty.graceEndsAt = null;
            return;
        }

        specialty.monthlyFeeSnapshot = monthlyFee;
        if (specialty.subscriptionStatus === 'free') {
            specialty.subscriptionStatus = 'pending_activation';
            specialty.isActive = false;
        }
    });
    await syncLegacyCategory(worker);
};

export const setWorkerPrimarySpecialtyFromLegacyCategory = async ({
    worker,
    categoryName,
    approveImmediately = false,
    adminId,
}: {
    worker: IWorker;
    categoryName: string;
    approveImmediately?: boolean;
    adminId?: string | mongoose.Types.ObjectId;
}) => {
    const category = await resolveCategoryByName(categoryName);
    if (!category) throw Object.assign(new Error('Category is not available'), { statusCode: 400 });
    await ensureLegacyPrimarySpecialty(worker);

    const currentPrimary = worker.specialties.find((specialty: any) => specialty.priority === 1);
    if (currentPrimary && toId(currentPrimary.categoryId) === toId(category._id)) {
        applySpecialtyProfile(currentPrimary, buildProfileFromWorker(worker));
        worker.category = category.name;
        await syncLegacyCategory(worker);
        return worker;
    }

    const existingIndex = worker.specialties.findIndex((specialty: any) => toId(specialty.categoryId) === toId(category._id));
    const existing = existingIndex >= 0 ? worker.specialties.splice(existingIndex, 1)[0] : null;
    if (currentPrimary) {
        currentPrimary.priority = 2;
    }

    const primarySpecialty: any = existing || {
        categoryId: category._id,
        requestedAt: new Date(),
        autoRenew: true
    };
    primarySpecialty.priority = 1;
    primarySpecialty.monthlyFeeSnapshot = 0;
    primarySpecialty.subscriptionStatus = 'free';
    primarySpecialty.approvalStatus = approveImmediately ? 'approved' : 'pending';
    primarySpecialty.isActive = approveImmediately;
    primarySpecialty.approvedAt = approveImmediately ? new Date() : null;
    primarySpecialty.approvedBy = approveImmediately && adminId ? toObjectId(adminId) : null;
    applySpecialtyProfile(primarySpecialty, buildProfileFromWorker(worker));

    worker.specialties.unshift(primarySpecialty);
    worker.specialties.forEach((specialty: any, index: number) => {
        specialty.priority = index + 1;
    });
    if (worker.specialties.length > MAX_WORKER_SPECIALTIES) {
        throw Object.assign(new Error(`Workers can add up to ${MAX_WORKER_SPECIALTIES} specialties`), { statusCode: 400 });
    }
    await recalculateSubscriptionStates(worker);
    worker.category = category.name;
    return worker;
};

export const requestWorkerSpecialty = async (
    workerId: string | mongoose.Types.ObjectId,
    categoryId: string | mongoose.Types.ObjectId,
    profile: SpecialtyProfileInput
) => {
    const worker = await Worker.findById(workerId);
    if (!worker) throw Object.assign(new Error('Worker not found'), { statusCode: 404 });
    await ensureLegacyPrimarySpecialty(worker);

    const category = await Category.findOne({ _id: categoryId, isActive: true });
    if (!category) throw Object.assign(new Error('Category is not available'), { statusCode: 404 });

    if (worker.specialties.some((specialty: any) => toId(specialty.categoryId) === toId(categoryId))) {
        throw Object.assign(new Error('This specialty has already been added'), { statusCode: 409 });
    }
    if (worker.specialties.length >= MAX_WORKER_SPECIALTIES) {
        throw Object.assign(new Error(`Workers can add up to ${MAX_WORKER_SPECIALTIES} specialties`), { statusCode: 400 });
    }
    const additionalCategoryMonthlyFee = await getAdditionalCategoryMonthlyFee();
    await ensureWalletCanRequestAdditionalCategory(workerId, additionalCategoryMonthlyFee);

    (worker.specialties as any).push({
        categoryId: category._id,
        priority: worker.specialties.length + 1,
        ...profile,
        isActive: false,
        approvalStatus: 'pending',
        subscriptionStatus: 'pending_activation',
        monthlyFeeSnapshot: 0,
        autoRenew: true,
        requestedAt: new Date()
    });
    await worker.save();
    return worker;
};

export const reviewWorkerSpecialty = async ({
    workerId,
    categoryId,
    approvalStatus,
    adminId,
}: {
    workerId: string | mongoose.Types.ObjectId;
    categoryId: string | mongoose.Types.ObjectId;
    approvalStatus: 'approved' | 'rejected';
    adminId: string | mongoose.Types.ObjectId;
}) => {
    const worker = await Worker.findById(workerId);
    if (!worker) throw Object.assign(new Error('Worker not found'), { statusCode: 404 });
    await ensureLegacyPrimarySpecialty(worker);

    const specialty = worker.specialties.find((item: any) => toId(item.categoryId) === toId(categoryId));
    if (!specialty) throw Object.assign(new Error('Worker specialty request not found'), { statusCode: 404 });

    const category = await Category.findById(categoryId);
    if (!category) throw Object.assign(new Error('Category not found'), { statusCode: 404 });

    if (approvalStatus === 'approved' && specialty.approvalStatus === 'approved' && specialty.isActive) {
        return worker;
    }

    const reviewedAt = new Date();
    specialty.approvalStatus = approvalStatus;
    specialty.approvedBy = toObjectId(adminId);
    specialty.approvedAt = reviewedAt;
    specialty.isActive = false;

    if (approvalStatus === 'approved') {
        if (!worker.isVerified) {
            throw Object.assign(new Error('Verify the worker identity before approving specialty requests'), { statusCode: 400 });
        }
        if (!category.isActive) {
            throw Object.assign(new Error('Category is currently inactive and cannot be approved'), { statusCode: 400 });
        }
        const configuredFee = specialty.priority <= FREE_SPECIALTY_LIMIT ? 0 : await getAdditionalCategoryMonthlyFee();
        specialty.monthlyFeeSnapshot = specialty.priority <= FREE_SPECIALTY_LIMIT ? 0 : configuredFee;
        specialty.autoRenew = true;
        if (specialty.priority <= FREE_SPECIALTY_LIMIT || configuredFee === 0) {
            specialty.subscriptionStatus = 'free';
            specialty.isActive = true;
        } else {
            specialty.subscriptionStatus = 'pending_activation';
            await chargeSpecialtyPeriod({ worker, specialty, periodStart: reviewedAt });
        }
    } else {
        specialty.subscriptionStatus = 'expired';
    }

    await syncLegacyCategory(worker);
    await worker.save();
    return worker;
};

export const approveFreeSpecialtiesForVerifiedWorker = async (worker: IWorker) => {
    await ensureLegacyPrimarySpecialty(worker);
    const now = new Date();
    worker.specialties.forEach((specialty) => {
        if (specialty.priority === 1 && specialty.approvalStatus === 'pending') {
            specialty.approvalStatus = 'approved';
            specialty.subscriptionStatus = 'free';
            specialty.monthlyFeeSnapshot = 0;
            specialty.isActive = true;
            specialty.approvedAt = now;
        }
    });
    await syncLegacyCategory(worker);
    await worker.save();
    return worker;
};

const chargeSpecialtyPeriod = async ({
    worker,
    specialty,
    periodStart,
}: {
    worker: IWorker;
    specialty: any;
    periodStart: Date;
}) => {
    const periodEnd = addMonths(periodStart, 1);
    const idempotencyKey = `specialty-subscription/${worker._id}/${specialty._id}/${periodStart.toISOString()}`;
    await deductSpecialtySubscription({
        workerId: worker._id,
        categoryId: specialty.categoryId,
        specialtyId: specialty._id,
        amount: specialty.monthlyFeeSnapshot,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        idempotencyKey
    });

    specialty.subscriptionStatus = 'active';
    specialty.isActive = true;
    specialty.currentPeriodStart = periodStart;
    specialty.currentPeriodEnd = periodEnd;
    specialty.nextBillingAt = periodEnd;
    specialty.lastChargedAt = new Date();
    specialty.graceEndsAt = null;
};

export const activateWorkerSpecialty = async (
    workerId: string | mongoose.Types.ObjectId,
    categoryId: string | mongoose.Types.ObjectId
) => {
    const worker = await Worker.findById(workerId);
    if (!worker) throw Object.assign(new Error('Worker not found'), { statusCode: 404 });
    const specialty = worker.specialties.find((item: any) => toId(item.categoryId) === toId(categoryId));
    if (!specialty) throw Object.assign(new Error('Worker specialty not found'), { statusCode: 404 });
    if (specialty.approvalStatus !== 'approved') {
        throw Object.assign(new Error('This specialty must be approved before activation'), { statusCode: 400 });
    }

    const category = await Category.findById(categoryId);
    if (!category?.isActive) throw Object.assign(new Error('Category is not available'), { statusCode: 400 });

    const monthlyFee = specialty.priority <= FREE_SPECIALTY_LIMIT
        ? 0
        : await getAdditionalCategoryMonthlyFee();
    specialty.monthlyFeeSnapshot = monthlyFee;
    specialty.autoRenew = true;

    if (monthlyFee === 0) {
        specialty.subscriptionStatus = 'free';
        specialty.isActive = true;
        await worker.save();
        return worker;
    }

    await chargeSpecialtyPeriod({ worker, specialty, periodStart: new Date() });

    await worker.save();
    return worker;
};

export const setWorkerSpecialtyAutoRenew = async ({
    workerId,
    categoryId,
    autoRenew,
}: {
    workerId: string | mongoose.Types.ObjectId;
    categoryId: string | mongoose.Types.ObjectId;
    autoRenew: boolean;
}) => {
    const worker = await Worker.findById(workerId);
    if (!worker) throw Object.assign(new Error('Worker not found'), { statusCode: 404 });
    const specialty = worker.specialties.find((item: any) => toId(item.categoryId) === toId(categoryId));
    if (!specialty) throw Object.assign(new Error('Worker specialty not found'), { statusCode: 404 });
    specialty.autoRenew = Boolean(autoRenew);
    await worker.save();
    return worker;
};

export const reorderWorkerSpecialties = async (
    workerId: string | mongoose.Types.ObjectId,
    categoryIds: Array<string | mongoose.Types.ObjectId>
) => {
    const worker = await Worker.findById(workerId);
    if (!worker) throw Object.assign(new Error('Worker not found'), { statusCode: 404 });
    await ensureLegacyPrimarySpecialty(worker);

    const requestedIds = categoryIds.map(toId);
    const existingIds = worker.specialties.map((specialty: any) => toId(specialty.categoryId));
    if (requestedIds.length !== existingIds.length || new Set(requestedIds).size !== existingIds.length) {
        throw Object.assign(new Error('Provide every specialty exactly once when updating priorities'), { statusCode: 400 });
    }
    if (requestedIds.some((id) => !existingIds.includes(id))) {
        throw Object.assign(new Error('Priority update contains an unknown specialty'), { statusCode: 400 });
    }

    worker.specialties.forEach((specialty: any) => {
        specialty.priority = requestedIds.indexOf(toId(specialty.categoryId)) + 1;
    });
    worker.specialties.sort((left: any, right: any) => left.priority - right.priority);
    await recalculateSubscriptionStates(worker);
    await worker.save();
    return worker;
};

export const removeWorkerSpecialty = async (
    workerId: string | mongoose.Types.ObjectId,
    categoryId: string | mongoose.Types.ObjectId
) => {
    const worker = await Worker.findById(workerId);
    if (!worker) throw Object.assign(new Error('Worker not found'), { statusCode: 404 });
    await ensureLegacyPrimarySpecialty(worker);
    if (worker.specialties.length <= 1) {
        throw Object.assign(new Error('A worker must keep at least one specialty'), { statusCode: 400 });
    }

    const index = worker.specialties.findIndex((item: any) => toId(item.categoryId) === toId(categoryId));
    if (index < 0) throw Object.assign(new Error('Worker specialty not found'), { statusCode: 404 });
    if ((worker.specialties[index] as any).priority === 1) {
        throw Object.assign(new Error('The primary free category cannot be removed'), { statusCode: 400 });
    }
    worker.specialties.splice(index, 1);
    worker.specialties.forEach((specialty: any, priorityIndex: number) => {
        specialty.priority = priorityIndex + 1;
    });
    await recalculateSubscriptionStates(worker);
    await worker.save();
    return worker;
};

export const getWorkerActiveSpecialtyNames = async (worker: any): Promise<string[]> => {
    if (worker?.isVerified !== true || worker?.isActive === false) return [];
    if (!worker?.specialties?.length) return worker?.category ? [worker.category] : [];
    const activeSpecialties = worker.specialties.filter(specialtyCanMatch);
    if (!activeSpecialties.length) return [];
    const categories = await Category.find({ _id: { $in: activeSpecialties.map((item: any) => item.categoryId) } }).select('name');
    return categories.map((category) => category.name);
};

export const buildWorkerSpecialtyCategoryFilter = async (categoryName: string, categoryId?: string | mongoose.Types.ObjectId) => {
    const category = categoryId
        ? await Category.findById(categoryId)
        : await resolveCategoryByName(categoryName, true);
    const legacyName = category?.name || categoryName;
    const legacyRegex = new RegExp(`^${escapeRegex(legacyName)}$`, 'i');
    const legacyFallback = {
        $and: [
            { $or: [{ specialties: { $exists: false } }, { specialties: { $size: 0 } }] },
            { category: legacyRegex }
        ]
    };

    if (!category) return legacyFallback;
    return {
        $or: [
            {
                specialties: {
                    $elemMatch: {
                        categoryId: category._id,
                        approvalStatus: 'approved',
                        isActive: true,
                        subscriptionStatus: { $in: ['free', 'active', 'payment_due'] }
                    }
                }
            },
            legacyFallback
        ]
    };
};

export const workerCanPerformCategory = async (
    workerId: string | mongoose.Types.ObjectId,
    categoryName: string,
    categoryId?: string | mongoose.Types.ObjectId
) => {
    const categoryFilter = await buildWorkerSpecialtyCategoryFilter(categoryName, categoryId);
    return Boolean(await Worker.exists({ _id: workerId, isActive: true, isVerified: true, ...categoryFilter }));
};

export const getWorkerMatchedSpecialtyProfile = async (
    worker: any,
    categoryName?: string,
    categoryId?: string | mongoose.Types.ObjectId
) => {
    if (!worker) return null;
    const category = categoryId
        ? await Category.findById(categoryId)
        : categoryName
            ? await resolveCategoryByName(categoryName, true)
            : null;
    const matchedCategoryId = toId(category?._id || categoryId);
    const matchedSpecialty = Array.isArray(worker.specialties)
        ? worker.specialties.find((specialty: any) => (
            specialtyCanMatch(specialty)
            && matchedCategoryId
            && toId(specialty.categoryId?._id || specialty.categoryId) === matchedCategoryId
        ))
        : null;

    if (matchedSpecialty) {
        return buildSpecialtyProfileSnapshot(worker, matchedSpecialty, category);
    }

    const requestedName = String(category?.name || categoryName || '').trim().toLowerCase();
    const legacyName = String(worker.category || '').trim().toLowerCase();
    if (requestedName && requestedName === legacyName) {
        return {
            categoryId: matchedCategoryId,
            category: category?.name || worker.category || '',
            priority: 1,
            tier: 'primary',
            ...buildProfileFromWorker(worker)
        };
    }

    return null;
};

export const applyMatchedSpecialtyProfileToWorkerPayload = async (
    worker: any,
    categoryName?: string,
    categoryId?: string | mongoose.Types.ObjectId
) => {
    const payload = worker?.toObject ? worker.toObject() : { ...worker };
    const matchedSpecialtyProfile = await getWorkerMatchedSpecialtyProfile(worker, categoryName, categoryId);
    if (!matchedSpecialtyProfile) return payload;

    return {
        ...payload,
        category: matchedSpecialtyProfile.category || payload.category,
        skills: matchedSpecialtyProfile.skills,
        hourlyRate: matchedSpecialtyProfile.hourlyRate,
        experience: matchedSpecialtyProfile.experience,
        bio: matchedSpecialtyProfile.bio,
        matchedSpecialtyProfile
    };
};

export const renewWorkerSpecialty = async (
    workerId: string | mongoose.Types.ObjectId,
    specialtyId: string | mongoose.Types.ObjectId,
    now = new Date()
) => {
    const worker = await Worker.findById(workerId);
    if (!worker) return 'missing_worker';
    const specialty = worker.specialties.find((item: any) => toId(item._id) === toId(specialtyId));
    if (!specialty || specialty.approvalStatus !== 'approved' || !specialty.nextBillingAt) return 'not_due';
    if (specialty.nextBillingAt > now || !['active', 'payment_due'].includes(specialty.subscriptionStatus)) return 'not_due';

    if (!specialty.autoRenew) {
        specialty.subscriptionStatus = 'expired';
        specialty.isActive = false;
        await worker.save();
        return 'expired';
    }

    const category = await Category.findById(specialty.categoryId);
    if (!category?.isActive) {
        specialty.subscriptionStatus = 'expired';
        specialty.isActive = false;
        await worker.save();
        return 'expired';
    }
    if (specialty.subscriptionStatus === 'payment_due' && specialty.graceEndsAt && specialty.graceEndsAt <= now) {
        specialty.subscriptionStatus = 'expired';
        specialty.isActive = false;
        await worker.save();
        return 'expired';
    }

    specialty.monthlyFeeSnapshot = specialty.priority <= FREE_SPECIALTY_LIMIT ? 0 : await getAdditionalCategoryMonthlyFee();
    if (specialty.monthlyFeeSnapshot === 0 || specialty.priority <= FREE_SPECIALTY_LIMIT) {
        specialty.subscriptionStatus = 'free';
        specialty.isActive = true;
        specialty.nextBillingAt = null;
        specialty.graceEndsAt = null;
        await worker.save();
        return 'free';
    }

    try {
        await chargeSpecialtyPeriod({ worker, specialty, periodStart: specialty.nextBillingAt });
        await worker.save();
        return 'renewed';
    } catch (error: any) {
        if (error?.statusCode !== 402) throw error;

        const graceDays = Math.max(0, Number(category.additionalCategoryGraceDays || 0));
        specialty.graceEndsAt = specialty.graceEndsAt || addDays(now, graceDays);
        if (specialty.graceEndsAt <= now) {
            specialty.subscriptionStatus = 'expired';
            specialty.isActive = false;
            await worker.save();
            return 'expired';
        }

        specialty.subscriptionStatus = 'payment_due';
        specialty.isActive = true;
        await worker.save();
        return 'payment_due';
    }
};

export const processDueSpecialtyRenewals = async (now = new Date()) => {
    const workers = await Worker.find({
        specialties: {
            $elemMatch: {
                nextBillingAt: { $lte: now },
                subscriptionStatus: { $in: ['active', 'payment_due'] }
            }
        }
    }).select('specialties category isVerified');

    const summary = { checked: 0, renewed: 0, paymentDue: 0, expired: 0, free: 0 };
    for (const worker of workers) {
        const dueSpecialties = worker.specialties.filter((specialty: any) => (
            specialty.nextBillingAt
            && specialty.nextBillingAt <= now
            && ['active', 'payment_due'].includes(specialty.subscriptionStatus)
        ));
        for (const specialty of dueSpecialties) {
            summary.checked += 1;
            const result = await renewWorkerSpecialty(worker._id, specialty._id, now);
            if (result === 'renewed') summary.renewed += 1;
            if (result === 'payment_due') summary.paymentDue += 1;
            if (result === 'expired') summary.expired += 1;
            if (result === 'free') summary.free += 1;
        }
    }
    return summary;
};
