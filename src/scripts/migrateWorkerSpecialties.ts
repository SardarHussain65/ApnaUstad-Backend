import mongoose from 'mongoose';
import Category from '../models/Category';
import Worker from '../models/Workers';
import WorkerWallet from '../models/WorkerWallet';
import WalletSettings from '../models/WalletSettings';
import { getConfig } from '../config/env';

const config = getConfig();
const dryRun = process.argv.includes('--dry-run');
const FREE_SPECIALTY_LIMIT = 1;

const cleanSkills = (skills: unknown) => (
    Array.isArray(skills)
        ? skills.map((skill) => String(skill || '').trim()).filter(Boolean).slice(0, 10)
        : []
);

const migrateWorkerSpecialties = async () => {
    if (!config.mongodbUrl) throw new Error('MONGODB_URL is required');
    await mongoose.connect(config.mongodbUrl);

    const walletSettings = await WalletSettings.findOne({ key: 'default' });
    const configuredAdditionalFee = Math.max(0, Number(walletSettings?.additionalCategoryMonthlyFee ?? 500));
    const additionalCategoryMonthlyFee = Number.isFinite(configuredAdditionalFee) ? configuredAdditionalFee : 500;
    const categories = await Category.find({});
    const categoryByName = new Map(categories.map((category) => [category.name.trim().toLowerCase(), category]));
    const categoryById = new Map(categories.map((category) => [category._id.toString(), category]));
    const workers = await Worker.find({});

    const unresolved: Array<{ workerId: string; fullName: string; category: string }> = [];
    let migrated = 0;
    let updatedSpecialtyProfiles = 0;
    let recalculatedPaidSpecialties = 0;
    for (const worker of workers) {
        const category = categoryByName.get(String(worker.category || '').trim().toLowerCase());
        if ((!worker.specialties || worker.specialties.length === 0) && !category) {
            unresolved.push({
                workerId: worker._id.toString(),
                fullName: worker.fullName,
                category: worker.category
            });
            continue;
        }

        const isApproved = worker.isVerified === true;
        if (!worker.specialties || worker.specialties.length === 0) {
            if (!dryRun && category) {
                worker.category = category.name;
                (worker.specialties as any).push({
                    categoryId: category._id,
                    priority: 1,
                    skills: cleanSkills(worker.skills),
                    hourlyRate: Number(worker.hourlyRate || 0),
                    experience: Number(worker.experience || 0),
                    bio: worker.bio || '',
                    isActive: isApproved,
                    approvalStatus: isApproved ? 'approved' : 'pending',
                    subscriptionStatus: 'free',
                    monthlyFeeSnapshot: 0,
                    autoRenew: true,
                    requestedAt: worker.createdAt || new Date(),
                    approvedAt: isApproved ? new Date() : null
                });
                await worker.save();
            }
            migrated += 1;
            continue;
        }

        for (const specialty of worker.specialties as any[]) {
            let changedProfile = false;
            if (!Array.isArray(specialty.skills) || specialty.skills.length === 0) {
                specialty.skills = cleanSkills(worker.skills);
                changedProfile = true;
            }
            if (!specialty.hourlyRate) {
                specialty.hourlyRate = Number(worker.hourlyRate || 0);
                changedProfile = true;
            }
            if (specialty.experience === undefined || specialty.experience === null) {
                specialty.experience = Number(worker.experience || 0);
                changedProfile = true;
            }
            if (!specialty.bio) {
                specialty.bio = worker.bio || '';
                changedProfile = true;
            }
            if (changedProfile) updatedSpecialtyProfiles += 1;

            if (specialty.approvalStatus !== 'approved') {
                specialty.isActive = false;
                continue;
            }

            if (specialty.priority <= FREE_SPECIALTY_LIMIT) {
                specialty.subscriptionStatus = 'free';
                specialty.monthlyFeeSnapshot = 0;
                specialty.isActive = true;
                specialty.currentPeriodStart = null;
                specialty.currentPeriodEnd = null;
                specialty.nextBillingAt = null;
                specialty.graceEndsAt = null;
                continue;
            }

            const monthlyFee = additionalCategoryMonthlyFee;
            if (Number(specialty.monthlyFeeSnapshot || 0) !== monthlyFee) {
                recalculatedPaidSpecialties += 1;
            }
            specialty.monthlyFeeSnapshot = monthlyFee;
            if (monthlyFee === 0) {
                specialty.subscriptionStatus = 'free';
                specialty.isActive = true;
            } else if (specialty.subscriptionStatus === 'free') {
                specialty.subscriptionStatus = 'pending_activation';
                specialty.isActive = false;
                specialty.currentPeriodStart = null;
                specialty.currentPeriodEnd = null;
                specialty.nextBillingAt = null;
                specialty.graceEndsAt = null;
            }
        }

        const primary = (worker.specialties as any[]).find((specialty) => specialty.priority === 1);
        const primaryCategory = primary ? categoryById.get(String(primary.categoryId || '')) : null;
        if (primary && primaryCategory) {
            worker.category = primaryCategory.name;
            worker.skills = cleanSkills(primary.skills);
            worker.hourlyRate = Number(primary.hourlyRate || worker.hourlyRate || 0);
            worker.experience = Number(primary.experience || worker.experience || 0);
            worker.bio = primary.bio || worker.bio || '';
        }

        if (!dryRun) {
            await worker.save();
        }
        migrated += 1;
    }

    if (!dryRun) {
        if (!walletSettings) {
            await WalletSettings.create({
                key: 'default',
                platformFeePercentage: config.platformFeePercentage || 10,
                minimumWalletBalance: config.minimumWalletBalance || 500,
                additionalCategoryMonthlyFee,
                commissionEnabled: true
            });
        } else if (walletSettings.additionalCategoryMonthlyFee === undefined || walletSettings.additionalCategoryMonthlyFee === null) {
            walletSettings.additionalCategoryMonthlyFee = additionalCategoryMonthlyFee;
            await walletSettings.save();
        }
        await WorkerWallet.updateMany(
            { totalSubscriptionDeducted: { $exists: false } },
            { $set: { totalSubscriptionDeducted: 0 } }
        );
        await Promise.all([
            Category.updateMany({ additionalCategoryMonthlyFee: { $exists: false } }, { $set: { additionalCategoryMonthlyFee: 0 } }),
            Category.updateMany({ additionalCategoryGraceDays: { $exists: false } }, { $set: { additionalCategoryGraceDays: 3 } })
        ]);
    }

    console.log(JSON.stringify({
        dryRun,
        scannedWorkers: workers.length,
        migratedWorkers: migrated,
        updatedSpecialtyProfiles,
        recalculatedPaidSpecialties,
        unresolvedWorkers: unresolved.length,
        unresolved
    }, null, 2));
};

migrateWorkerSpecialties()
    .catch((error) => {
        console.error('Worker specialty migration failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
