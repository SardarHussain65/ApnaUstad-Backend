import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler';
import { successResponse } from '../utils/ApiResponse';
import { BadRequestError, NotFoundError } from '../utils/ApiError';
import { AdminAuthRequest } from '../middlewares/admin.middleware';
import { recordAdminAction } from '../services/adminAuditLog';
import { hasAdminPermission } from '../config/adminPermissions';
import {
  MetricKey,
  getActionCounts,
  getDashboardSummary,
  getTimeseries,
  isMetricKey,
} from '../services/adminAnalytics';
import { parseInterval, parseRange, rangeDays } from '../utils/adminRange';
import { checkReason, extractReason } from '../utils/adminReason';
import { normalizeCnic } from '../utils/cnic';
import User from '../models/User';
import Worker from '../models/Workers';
import Booking from '../models/Booking';
import JobPost from '../models/JobPost';
import Payment from '../models/Payment';
import WalletTopUpRequest from '../models/WalletTopUpRequest';

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Dashboard summary with optional previous-period comparison.
 * @route GET /api/v1/admin/dashboard/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&compare=true
 */
export const getSummary = asyncHandler(async (req: AdminAuthRequest, res) => {
  const range = parseRange(req.query.from, req.query.to);
  const compare = req.query.compare !== 'false';
  const data = await getDashboardSummary(range, compare);
  return successResponse(res, 200, 'Dashboard summary fetched successfully', data);
});

/**
 * Zero-filled time series for one or more metrics.
 * @route GET /api/v1/admin/analytics/timeseries?metrics=revenue,bookings&from&to&interval=day|week|month
 */
export const getTimeseriesHandler = asyncHandler(async (req: AdminAuthRequest, res) => {
  const requested = String(req.query.metrics || req.query.metric || 'revenue')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const invalid = requested.filter((m) => !isMetricKey(m));
  if (invalid.length) throw new BadRequestError(`Unknown metric(s): ${invalid.join(', ')}`);
  if (requested.length > 6) throw new BadRequestError('At most 6 metrics per request');

  const range = parseRange(req.query.from, req.query.to);
  const interval = parseInterval(req.query.interval, rangeDays(range));
  const data = await getTimeseries(requested as MetricKey[], range, interval);
  return successResponse(res, 200, 'Timeseries fetched successfully', {
    ...data,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
  });
});

/**
 * Open work-item counts for sidebar badges and the Action Center.
 * @route GET /api/v1/admin/dashboard/action-counts
 */
export const getActionCountsHandler = asyncHandler(async (_req: AdminAuthRequest, res) => {
  const counts = await getActionCounts();
  return successResponse(res, 200, 'Action counts fetched successfully', counts);
});

interface SearchHit {
  type: 'user' | 'worker' | 'booking' | 'job' | 'payment' | 'topup';
  id: string;
  title: string;
  subtitle: string;
  href: string;
  status?: string;
}

/**
 * Global search for the command palette (role-aware: only entities the admin may see).
 * @route GET /api/v1/admin/search?q=
 */
export const globalSearch = asyncHandler(async (req: AdminAuthRequest, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q.length < 2) return successResponse(res, 200, 'Search results', { query: q, hits: [] });

  const role = req.admin?.role || '';
  const rx = new RegExp(escapeRegex(q), 'i');
  const objectId = /^[a-f\d]{24}$/i.test(q) ? new mongoose.Types.ObjectId(q) : null;
  const cnic = normalizeCnic(q);
  const LIMIT = 5;
  const tasks: Array<Promise<SearchHit[]>> = [];

  if (hasAdminPermission(role, 'users')) {
    tasks.push(
      User.find({ $or: [{ fullName: rx }, { phone: rx }, { email: rx }, ...(objectId ? [{ _id: objectId }] : [])] })
        .select('fullName phone email isActive')
        .limit(LIMIT)
        .lean()
        .then((rows: any[]) =>
          rows.map((u) => ({
            type: 'user' as const,
            id: String(u._id),
            title: u.fullName || 'Unnamed user',
            subtitle: u.email || u.phone || '',
            href: `/users?focus=${u._id}`,
            status: u.isActive ? 'active' : 'inactive',
          }))
        )
    );
  }

  if (hasAdminPermission(role, 'workers')) {
    tasks.push(
      Worker.find({
        $or: [
          { fullName: rx },
          { phone: rx },
          { category: rx },
          ...(cnic ? [{ cnicNumber: cnic }] : []),
          ...(objectId ? [{ _id: objectId }] : []),
        ],
      })
        .select('fullName phone category isVerified isActive')
        .limit(LIMIT)
        .lean()
        .then((rows: any[]) =>
          rows.map((w) => ({
            type: 'worker' as const,
            id: String(w._id),
            title: w.fullName || 'Unnamed worker',
            subtitle: [w.category, w.phone].filter(Boolean).join(' · '),
            href: `/workers/${w._id}`,
            status: w.isVerified ? 'verified' : 'unverified',
          }))
        )
    );
  }

  if (hasAdminPermission(role, 'bookings')) {
    tasks.push(
      Booking.find(objectId ? { _id: objectId } : { $or: [{ category: rx }, { description: rx }] })
        .select('category description status totalAmount')
        .sort({ createdAt: -1 })
        .limit(LIMIT)
        .lean()
        .then((rows: any[]) =>
          rows.map((b) => ({
            type: 'booking' as const,
            id: String(b._id),
            title: `${b.category} booking`,
            subtitle: String(b.description || '').slice(0, 80),
            href: `/bookings?focus=${b._id}`,
            status: b.status,
          }))
        )
    );
  }

  if (hasAdminPermission(role, 'jobs')) {
    tasks.push(
      JobPost.find({
        deletedAt: null,
        ...(objectId ? { _id: objectId } : { $or: [{ category: rx }, { description: rx }] }),
      })
        .select('category description status')
        .sort({ createdAt: -1 })
        .limit(LIMIT)
        .lean()
        .then((rows: any[]) =>
          rows.map((j) => ({
            type: 'job' as const,
            id: String(j._id),
            title: `${j.category} job`,
            subtitle: String(j.description || '').slice(0, 80),
            href: `/jobs?focus=${j._id}`,
            status: j.status,
          }))
        )
    );
  }

  if (hasAdminPermission(role, 'payments')) {
    tasks.push(
      Payment.find(objectId ? { $or: [{ _id: objectId }, { booking: objectId }] } : { receiptNumber: rx })
        .select('receiptNumber amount status')
        .sort({ createdAt: -1 })
        .limit(LIMIT)
        .lean()
        .then((rows: any[]) =>
          rows.map((p) => ({
            type: 'payment' as const,
            id: String(p._id),
            title: p.receiptNumber || `Payment ${String(p._id).slice(-6)}`,
            subtitle: `Rs ${Number(p.amount || 0).toLocaleString('en-PK')}`,
            href: `/payments?focus=${p._id}`,
            status: p.status,
          }))
        )
    );
  }

  if (hasAdminPermission(role, 'wallets')) {
    tasks.push(
      WalletTopUpRequest.find(objectId ? { _id: objectId } : { requestId: rx })
        .select('requestId amount status method')
        .sort({ createdAt: -1 })
        .limit(LIMIT)
        .lean()
        .then((rows: any[]) =>
          rows.map((t) => ({
            type: 'topup' as const,
            id: String(t._id),
            title: t.requestId,
            subtitle: `Rs ${Number(t.amount || 0).toLocaleString('en-PK')} · ${t.method}`,
            href: `/wallets?tab=topups&focus=${t._id}`,
            status: t.status,
          }))
        )
    );
  }

  const hits = (await Promise.all(tasks)).flat();
  return successResponse(res, 200, 'Search results', { query: q, hits });
});

/**
 * Reveal a worker's full CNIC number and ID images. Requires `cnic:reveal` and a reason;
 * every reveal is written to the audit log. By default CNIC numbers are masked in all
 * `/admin/workers*` and `/admin/verification*` responses.
 * @route POST /api/v1/admin/workers/:id/reveal-cnic
 */
export const revealWorkerCnic = asyncHandler(async (req: AdminAuthRequest, res) => {
  const check = checkReason(extractReason(req.body, undefined), true);
  if (!check.ok) throw new BadRequestError(check.message);

  const worker = await Worker.findById(req.params.id).select('fullName cnicNumber cnicFrontImage cnicBackImage');
  if (!worker) throw new NotFoundError('Worker not found');

  await recordAdminAction(req, {
    action: 'worker.cnic.reveal',
    entityType: 'worker',
    entityId: worker._id.toString(),
    reason: check.reason,
    metadata: { fullName: worker.fullName },
  });

  return successResponse(res, 200, 'CNIC revealed', {
    cnicNumber: worker.cnicNumber || '',
    cnicFrontImage: worker.cnicFrontImage || '',
    cnicBackImage: worker.cnicBackImage || '',
  });
});
