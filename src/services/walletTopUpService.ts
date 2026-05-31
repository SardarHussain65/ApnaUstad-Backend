import mongoose from 'mongoose';
import Admin from '../models/Admin';
import Notification from '../models/Notifications';
import WalletPaymentMethod from '../models/WalletPaymentMethod';
import WalletTransaction from '../models/WalletTransaction';
import WalletTopUpRequest, { WalletTopUpMethod } from '../models/WalletTopUpRequest';
import Worker from '../models/Workers';
import { getConfig } from '../config/env';
import { sendWalletTopUpAdminAlert } from './emailService';
import { getOrCreateWallet, rechargeWallet } from './workerWalletService';
import logger from '../config/logger';

export type WalletPaymentMethodConfig = ReturnType<typeof getConfig>['walletPaymentMethods'][number] & {
    _id?: string;
    sortOrder?: number;
    updatedAt?: Date;
};

type PaymentMethodUpdateInput = {
    method: WalletTopUpMethod;
    label?: string;
    accountTitle?: string;
    accountNumber?: string;
    bankName?: string;
    iban?: string;
    instructions?: string;
    enabled?: boolean;
    sortOrder?: number;
};

const METHOD_ORDER: WalletTopUpMethod[] = ['easypaisa', 'jazzcash', 'bank_transfer', 'other'];

const buildRequestId = () => {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const suffix = new mongoose.Types.ObjectId().toString().slice(-6).toUpperCase();
    return `WTU-${datePart}-${suffix}`;
};

const isPaymentMethodConfigured = (method: Partial<WalletPaymentMethodConfig>) => {
    if (method.method === 'bank_transfer') {
        return Boolean(method.accountNumber || method.iban);
    }

    if (method.method === 'other') {
        return Boolean(method.accountNumber || method.instructions);
    }

    return Boolean(method.accountNumber);
};

const normalizePaymentMethod = (method: any, fallback?: any): WalletPaymentMethodConfig => {
    const normalized = {
        method: method.method,
        label: method.label ?? fallback?.label ?? method.method,
        accountTitle: method.accountTitle ?? fallback?.accountTitle ?? '',
        accountNumber: method.accountNumber ?? fallback?.accountNumber ?? '',
        bankName: method.bankName ?? fallback?.bankName ?? '',
        iban: method.iban ?? fallback?.iban ?? '',
        instructions: method.instructions ?? fallback?.instructions ?? '',
        enabled: typeof method.enabled === 'boolean' ? method.enabled : fallback?.enabled !== false,
        sortOrder: method.sortOrder ?? fallback?.sortOrder ?? METHOD_ORDER.indexOf(method.method),
        _id: method._id?.toString?.(),
        updatedAt: method.updatedAt,
        isConfigured: false,
    };

    return {
        ...normalized,
        isConfigured: isPaymentMethodConfigured(normalized),
    };
};

export const getConfiguredPaymentMethods = async ({ includeDisabled = false }: { includeDisabled?: boolean } = {}) => {
    const envMethods = getConfig().walletPaymentMethods.map((method, index) => normalizePaymentMethod({
        ...method,
        sortOrder: index,
    }));
    const envByMethod = new Map(envMethods.map((method) => [method.method, method]));
    const savedMethods = await WalletPaymentMethod.find({}).lean();

    savedMethods.forEach((method) => {
        envByMethod.set(method.method as WalletTopUpMethod, normalizePaymentMethod(method, envByMethod.get(method.method as WalletTopUpMethod)));
    });

    return Array.from(envByMethod.values())
        .filter((method) => includeDisabled || method.enabled)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
};

export const updateConfiguredPaymentMethods = async ({
    methods,
    adminId,
}: {
    methods: PaymentMethodUpdateInput[];
    adminId?: string | mongoose.Types.ObjectId;
}) => {
    const allowedMethods = new Set(METHOD_ORDER);

    for (const method of methods) {
        if (!allowedMethods.has(method.method)) {
            const error = new Error(`Unsupported payment method: ${method.method}`);
            (error as any).statusCode = 400;
            throw error;
        }
    }

    await Promise.all(methods.map((method) => WalletPaymentMethod.updateOne(
        { method: method.method },
        {
            $set: {
                label: method.label?.trim() || method.method,
                accountTitle: method.accountTitle?.trim() || '',
                accountNumber: method.accountNumber?.trim() || '',
                bankName: method.bankName?.trim() || '',
                iban: method.iban?.trim().toUpperCase() || '',
                instructions: method.instructions?.trim() || '',
                enabled: method.enabled !== false,
                sortOrder: method.sortOrder ?? METHOD_ORDER.indexOf(method.method),
                updatedBy: adminId ? new mongoose.Types.ObjectId(adminId) : null,
            }
        },
        { upsert: true }
    )));

    return getConfiguredPaymentMethods({ includeDisabled: true });
};

export const getPaymentMethodByKey = async (method: string): Promise<WalletPaymentMethodConfig | undefined> => {
    const methods = await getConfiguredPaymentMethods();
    return methods.find((item) => item.method === method);
};

export const createWalletTopUpRequest = async ({
    workerId,
    amount,
    method,
    proofImageUrl,
}: {
    workerId: string | mongoose.Types.ObjectId;
    amount: number;
    method: WalletTopUpMethod;
    proofImageUrl: string;
}) => {
    const paymentMethod = await getPaymentMethodByKey(method);
    if (!paymentMethod) {
        const error = new Error('Selected payment method is not available');
        (error as any).statusCode = 400;
        throw error;
    }

    if (!paymentMethod.isConfigured) {
        const error = new Error(`${paymentMethod.label} payment details are not configured yet. Please contact support.`);
        (error as any).statusCode = 400;
        throw error;
    }

    const worker = await Worker.findById(workerId).select('fullName phone email profileImage');
    if (!worker) {
        const error = new Error('Worker not found');
        (error as any).statusCode = 404;
        throw error;
    }

    const wallet = await getOrCreateWallet(workerId);
    const topUpRequest = await WalletTopUpRequest.create({
        requestId: buildRequestId(),
        worker: workerId,
        wallet: wallet._id,
        amount,
        method,
        proofImageUrl,
        status: 'pending',
        paymentDetailsSnapshot: {
            method: paymentMethod.method,
            label: paymentMethod.label,
            accountTitle: paymentMethod.accountTitle || '',
            accountNumber: paymentMethod.accountNumber || '',
            bankName: (paymentMethod as any).bankName || '',
            iban: (paymentMethod as any).iban || '',
            instructions: paymentMethod.instructions || ''
        }
    });

    notifyAdminsAboutTopUp(topUpRequest, worker).catch((error) => {
        logger.error('Failed to notify admins about wallet top-up request:', error);
    });

    return topUpRequest.populate('worker', 'fullName phone email profileImage');
};

const notifyAdminsAboutTopUp = async (topUpRequest: any, worker: any) => {
    await sendWalletTopUpAdminAlert({
        workerName: worker.fullName || 'Worker',
        workerPhone: worker.phone,
        amount: topUpRequest.amount,
        methodLabel: topUpRequest.paymentDetailsSnapshot?.label || topUpRequest.method,
        requestId: topUpRequest.requestId,
    });

    const admins = await Admin.find({}).select('_id').limit(20);
    if (!admins.length) return;

    await Notification.insertMany(admins.map((admin) => ({
        recipient: admin._id,
        recipientType: 'admin',
        title: 'New wallet top-up request',
        message: `${worker.fullName || 'A worker'} submitted Rs. ${Number(topUpRequest.amount).toLocaleString('en-PK')} top-up proof.`,
        type: 'wallet_topup',
        icon: 'wallet',
        color: '#00F5FF',
        isRead: false,
        idempotencyKey: `wallet-topup-admin/${topUpRequest.requestId}/${admin._id}`
    })), { ordered: false }).catch((error) => {
        if (error?.code !== 11000) throw error;
    });
};

export const approveWalletTopUpRequest = async ({
    requestId,
    adminId,
    adminNotes = '',
}: {
    requestId: string;
    adminId: string | mongoose.Types.ObjectId;
    adminNotes?: string;
}) => {
    const topUpRequest = await WalletTopUpRequest.findById(requestId);
    if (!topUpRequest) {
        const error = new Error('Top-up request not found');
        (error as any).statusCode = 404;
        throw error;
    }

    if (topUpRequest.status !== 'pending') {
        const error = new Error(`Only pending top-up requests can be approved. Current status: ${topUpRequest.status}`);
        (error as any).statusCode = 400;
        throw error;
    }

    const existingCredit = await WalletTransaction.findOne({ 'reference.topUpRequest': topUpRequest._id });
    const wallet = existingCredit
        ? await getOrCreateWallet(topUpRequest.worker)
        : await rechargeWallet(
            topUpRequest.worker,
            topUpRequest.amount,
            { actor: adminId, actorType: 'admin' },
            `Approved wallet top-up ${topUpRequest.requestId}`,
            { topUpRequest: topUpRequest._id }
        );

    topUpRequest.status = 'approved';
    topUpRequest.admin = new mongoose.Types.ObjectId(adminId);
    topUpRequest.adminNotes = adminNotes;
    topUpRequest.approvedAt = new Date();
    await topUpRequest.save();

    return { topUpRequest: await topUpRequest.populate('worker', 'fullName phone email profileImage'), wallet };
};

export const rejectWalletTopUpRequest = async ({
    requestId,
    adminId,
    rejectionReason,
    adminNotes = '',
}: {
    requestId: string;
    adminId: string | mongoose.Types.ObjectId;
    rejectionReason: string;
    adminNotes?: string;
}) => {
    const topUpRequest = await WalletTopUpRequest.findById(requestId);
    if (!topUpRequest) {
        const error = new Error('Top-up request not found');
        (error as any).statusCode = 404;
        throw error;
    }

    if (topUpRequest.status !== 'pending') {
        const error = new Error(`Only pending top-up requests can be rejected. Current status: ${topUpRequest.status}`);
        (error as any).statusCode = 400;
        throw error;
    }

    topUpRequest.status = 'rejected';
    topUpRequest.admin = new mongoose.Types.ObjectId(adminId);
    topUpRequest.rejectionReason = rejectionReason;
    topUpRequest.adminNotes = adminNotes;
    topUpRequest.rejectedAt = new Date();
    await topUpRequest.save();

    return topUpRequest.populate('worker', 'fullName phone email profileImage');
};

export const buildTopUpSummary = async (baseQuery: any = {}) => {
    const rows = await WalletTopUpRequest.aggregate([
        { $match: baseQuery },
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
                amount: { $sum: '$amount' }
            }
        }
    ]);

    return rows.reduce((acc: any, row: any) => {
        acc[row._id] = { count: row.count, amount: row.amount };
        return acc;
    }, {
        pending: { count: 0, amount: 0 },
        approved: { count: 0, amount: 0 },
        rejected: { count: 0, amount: 0 },
    });
};
