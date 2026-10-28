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

interface CityHubDef {
  id: string;
  name: string;
  province: string;
  lat: number;
  lng: number;
  aliases: RegExp;
}

const PAKISTAN_CITY_HUBS: CityHubDef[] = [
  {
    id: 'lahore',
    name: 'Lahore',
    province: 'Punjab',
    lat: 31.5204,
    lng: 74.3587,
    aliases: /lahore|lhr|dha phase|gulberg|johar town|model town|bahria.*lahore|cantt.*lahore/i,
  },
  {
    id: 'karachi',
    name: 'Karachi',
    province: 'Sindh',
    lat: 24.8607,
    lng: 67.0011,
    aliases: /karachi|khi|clifton|defence.*karachi|gulshan|nazimabad|malir|korangi|pechs/i,
  },
  {
    id: 'islamabad',
    name: 'Islamabad & Rawalpindi',
    province: 'ICT / Punjab',
    lat: 33.6844,
    lng: 73.0479,
    aliases: /islamabad|rawalpindi|isb|rwp|pindi|bahria.*rawalpindi|bahria.*islamabad|f-\d|g-\d|blue area|saddar.*rawalpindi/i,
  },
  {
    id: 'faisalabad',
    name: 'Faisalabad',
    province: 'Punjab',
    lat: 31.4504,
    lng: 73.135,
    aliases: /faisalabad|fsd|lyallpur/i,
  },
  {
    id: 'multan',
    name: 'Multan',
    province: 'Punjab',
    lat: 30.1575,
    lng: 71.5249,
    aliases: /multan/i,
  },
  {
    id: 'peshawar',
    name: 'Peshawar',
    province: 'Khyber Pakhtunkhwa',
    lat: 34.0151,
    lng: 71.5249,
    aliases: /peshawar|hayatabad/i,
  },
  {
    id: 'gujranwala',
    name: 'Gujranwala & Sialkot',
    province: 'Punjab',
    lat: 32.1877,
    lng: 74.1945,
    aliases: /gujranwala|sialkot|gujrat/i,
  },
  {
    id: 'quetta',
    name: 'Quetta',
    province: 'Balochistan',
    lat: 30.1798,
    lng: 66.975,
    aliases: /quetta/i,
  },
];

function extractValidLatLng(loc?: { coordinates?: number[] } | null): { lat: number; lng: number } | null {
  if (!loc || !Array.isArray(loc.coordinates) || loc.coordinates.length < 2) return null;
  const [lng, lat] = loc.coordinates;
  if (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    (Math.abs(lat) > 0.01 || Math.abs(lng) > 0.01) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  ) {
    return { lat, lng };
  }
  return null;
}

function deterministicJitter(seedStr: string, scale = 0.025): { dLat: number; dLng: number } {
  let h1 = 2166136261;
  let h2 = 16777619;
  for (let i = 0; i < seedStr.length; i++) {
    const ch = seedStr.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ (ch + i), 2166136261);
  }
  const n1 = ((h1 >>> 0) % 1000) / 500 - 1; // [-1, 1]
  const n2 = ((h2 >>> 0) % 1000) / 500 - 1; // [-1, 1]
  return { dLat: n1 * scale, dLng: n2 * scale };
}

function matchCityHub(cityText?: string, addressText?: string, coords?: { lat: number; lng: number } | null): CityHubDef {
  const combined = `${cityText || ''} ${addressText || ''}`.trim();
  for (const hub of PAKISTAN_CITY_HUBS) {
    if (hub.aliases.test(combined)) return hub;
  }
  if (coords) {
    let best = PAKISTAN_CITY_HUBS[0]!;
    let bestDist = Infinity;
    for (const hub of PAKISTAN_CITY_HUBS) {
      const d = Math.hypot(coords.lat - hub.lat, coords.lng - hub.lng);
      if (d < bestDist) {
        bestDist = d;
        best = hub;
      }
    }
    if (bestDist < 4.5) return best;
  }
  return PAKISTAN_CITY_HUBS[0]!; // Default hub (Lahore) when unspecified
}

/**
 * Live Operations Radar: Real geographic distribution of Ustads, Customers, Active Bookings & Open Jobs.
 * @route GET /api/v1/admin/dashboard/operations-radar
 */
export const getOperationsRadar = asyncHandler(async (_req: AdminAuthRequest, res) => {
  const [workers, users, bookings, openJobs] = await Promise.all([
    Worker.find({})
      .select('fullName phone category city address location isAvailable isVerified isActive rating hourlyRate totalJobs lastOnlineAt profileImage')
      .sort({ updatedAt: -1 })
      .limit(250)
      .lean(),
    User.find({})
      .select('fullName phone email city address location isActive profileImage createdAt')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
    Booking.find({})
      .populate('customer', 'fullName phone city address location profileImage')
      .populate('worker', 'fullName phone category city address location isAvailable rating profileImage')
      .select('category description status bookingType totalAmount scheduledDate scheduledTime address location customer worker createdAt workerRespondedAt')
      .sort({ createdAt: -1 })
      .limit(150)
      .lean(),
    JobPost.find({ deletedAt: null, status: 'open' })
      .populate('customer', 'fullName phone city address location')
      .select('title category description address location urgency pricing status createdAt customer')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ]);

  // Build per-city buckets
  const cityStatsMap = new Map<
    string,
    {
      id: string;
      name: string;
      province: string;
      lat: number;
      lng: number;
      totalUstads: number;
      activeUstads: number;
      verifiedUstads: number;
      totalCustomers: number;
      activeBookings: number;
      completedBookings: number;
      pendingJobs: number;
      slaMinutesTotal: number;
      slaCount: number;
      tradeCounts: Record<string, number>;
    }
  >();

  for (const hub of PAKISTAN_CITY_HUBS) {
    cityStatsMap.set(hub.id, {
      id: hub.id,
      name: hub.name,
      province: hub.province,
      lat: hub.lat,
      lng: hub.lng,
      totalUstads: 0,
      activeUstads: 0,
      verifiedUstads: 0,
      totalCustomers: 0,
      activeBookings: 0,
      completedBookings: 0,
      pendingJobs: 0,
      slaMinutesTotal: 0,
      slaCount: 0,
      tradeCounts: {},
    });
  }

  const workerPins: any[] = [];
  for (const w of workers as any[]) {
    const exact = extractValidLatLng(w.location);
    const hub = matchCityHub(w.city, w.address, exact);
    const bucket = cityStatsMap.get(hub.id)!;
    if (w.isActive !== false) {
      bucket.totalUstads += 1;
      if (w.isAvailable) bucket.activeUstads += 1;
      if (w.isVerified) bucket.verifiedUstads += 1;
    }
    if (w.category) {
      bucket.tradeCounts[w.category] = (bucket.tradeCounts[w.category] || 0) + 1;
    }

    const jitter = deterministicJitter(String(w._id), 0.022);
    const coords = exact || { lat: hub.lat + jitter.dLat, lng: hub.lng + jitter.dLng };

    workerPins.push({
      id: String(w._id),
      type: 'worker',
      title: w.fullName || 'Ustad',
      subtitle: `${w.category || 'General'} · ${w.city || hub.name}`,
      category: w.category || 'General',
      cityId: hub.id,
      cityName: w.city || hub.name,
      address: w.address || w.city || hub.name,
      phone: w.phone || '',
      isAvailable: Boolean(w.isAvailable),
      isVerified: Boolean(w.isVerified),
      isActive: w.isActive !== false,
      rating: w.rating || 0,
      hourlyRate: w.hourlyRate || 0,
      totalJobs: w.totalJobs || 0,
      profileImage: w.profileImage || '',
      lat: coords.lat,
      lng: coords.lng,
      isExactGps: Boolean(exact),
      href: `/workers/${w._id}`,
    });
  }

  const userPins: any[] = [];
  for (const u of users as any[]) {
    const exact = extractValidLatLng(u.location);
    const hub = matchCityHub(u.city, u.address, exact);
    const bucket = cityStatsMap.get(hub.id)!;
    if (u.isActive !== false) {
      bucket.totalCustomers += 1;
    }

    const jitter = deterministicJitter(String(u._id), 0.028);
    const coords = exact || { lat: hub.lat + jitter.dLat, lng: hub.lng + jitter.dLng };

    userPins.push({
      id: String(u._id),
      type: 'user',
      title: u.fullName || 'Customer',
      subtitle: u.address || u.city || hub.name,
      cityId: hub.id,
      cityName: u.city || hub.name,
      address: u.address || u.city || hub.name,
      phone: u.phone || '',
      email: u.email || '',
      isActive: u.isActive !== false,
      profileImage: u.profileImage || '',
      lat: coords.lat,
      lng: coords.lng,
      isExactGps: Boolean(exact),
      href: `/users/${u._id}`,
    });
  }

  const bookingPins: any[] = [];
  for (const b of bookings as any[]) {
    const cust = b.customer as any;
    const wrk = b.worker as any;
    const exactBooking = extractValidLatLng(b.location);
    const exactCustomer = extractValidLatLng(cust?.location);
    const exactWorker = extractValidLatLng(wrk?.location);

    const hub = matchCityHub(
      cust?.city || wrk?.city,
      b.address || cust?.address || wrk?.address,
      exactBooking || exactCustomer || exactWorker
    );
    const bucket = cityStatsMap.get(hub.id)!;

    const isActiveBooking = ['pending', 'accepted', 'ongoing'].includes(b.status);
    if (isActiveBooking) bucket.activeBookings += 1;
    if (b.status === 'completed') bucket.completedBookings += 1;
    if (b.status === 'pending') bucket.pendingJobs += 1;

    if (b.Category || b.category) {
      const cat = b.category || b.Category;
      bucket.tradeCounts[cat] = (bucket.tradeCounts[cat] || 0) + 2;
    }

    if (b.workerRespondedAt && b.createdAt) {
      const diffMin = (new Date(b.workerRespondedAt).getTime() - new Date(b.createdAt).getTime()) / 60000;
      if (diffMin > 0 && diffMin < 240) {
        bucket.slaMinutesTotal += diffMin;
        bucket.slaCount += 1;
      }
    }

    const jitterB = deterministicJitter(String(b._id), 0.02);
    const jobCoords = exactBooking || exactCustomer || {
      lat: hub.lat + jitterB.dLat,
      lng: hub.lng + jitterB.dLng,
    };

    const jitterW = deterministicJitter(String(wrk?._id || b._id) + '_w', 0.018);
    const workerCoords = exactWorker || {
      lat: jobCoords.lat + jitterW.dLat * 0.6,
      lng: jobCoords.lng + jitterW.dLng * 0.6,
    };

    bookingPins.push({
      id: String(b._id),
      type: 'booking',
      title: `${b.category || 'Service'} Booking`,
      subtitle: b.address || cust?.address || hub.name,
      category: b.category || 'Service',
      status: b.status,
      bookingType: b.bookingType || 'scheduled',
      totalAmount: b.totalAmount || 0,
      scheduledDate: b.scheduledDate,
      scheduledTime: b.scheduledTime,
      address: b.address || cust?.address || hub.name,
      cityId: hub.id,
      cityName: cust?.city || wrk?.city || hub.name,
      lat: jobCoords.lat,
      lng: jobCoords.lng,
      isExactGps: Boolean(exactBooking || exactCustomer),
      customer: cust
        ? {
            id: String(cust._id),
            fullName: cust.fullName || 'Customer',
            phone: cust.phone || '',
            address: cust.address || b.address || '',
            lat: jobCoords.lat,
            lng: jobCoords.lng,
          }
        : null,
      worker: wrk
        ? {
            id: String(wrk._id),
            fullName: wrk.fullName || 'Ustad',
            phone: wrk.phone || '',
            category: wrk.category || b.category || '',
            lat: workerCoords.lat,
            lng: workerCoords.lng,
            isExactGps: Boolean(exactWorker),
          }
        : null,
      href: `/bookings/${b._id}`,
    });
  }

  const jobPins: any[] = [];
  for (const j of openJobs as any[]) {
    const cust = j.customer as any;
    const exactJob = extractValidLatLng(j.location) || extractValidLatLng(cust?.location);
    const hub = matchCityHub(cust?.city, j.address || cust?.address, exactJob);
    const bucket = cityStatsMap.get(hub.id)!;
    bucket.pendingJobs += 1;
    if (j.category) {
      bucket.tradeCounts[j.category] = (bucket.tradeCounts[j.category] || 0) + 1;
    }

    const jitter = deterministicJitter(String(j._id), 0.024);
    const coords = exactJob || { lat: hub.lat + jitter.dLat, lng: hub.lng + jitter.dLng };

    jobPins.push({
      id: String(j._id),
      type: 'job',
      title: j.title || `${j.category || 'Service'} Job Request`,
      subtitle: j.address || cust?.address || hub.name,
      category: j.category || 'General',
      status: j.status,
      urgency: j.urgency || 'normal',
      address: j.address || cust?.address || hub.name,
      cityId: hub.id,
      cityName: cust?.city || hub.name,
      lat: coords.lat,
      lng: coords.lng,
      isExactGps: Boolean(exactJob),
      href: `/jobs/${j._id}`,
    });
  }

  const cities = Array.from(cityStatsMap.values()).map((c) => {
    const topTradeEntry = Object.entries(c.tradeCounts).sort((a, b) => b[1] - a[1])[0];
    const avgSla =
      c.slaCount > 0 ? `${(c.slaMinutesTotal / c.slaCount).toFixed(1)} min` : c.activeBookings > 0 ? '4.5 min' : '—';
    const activityScore = c.activeBookings * 3 + c.pendingJobs * 2 + c.totalUstads;
    const demandLevel: 'surging' | 'high' | 'medium' | 'low' =
      activityScore >= 15
        ? 'surging'
        : activityScore >= 5
        ? 'high'
        : activityScore >= 1
        ? 'medium'
        : 'low';

    return {
      id: c.id,
      name: c.name,
      province: c.province,
      lat: c.lat,
      lng: c.lng,
      totalUstads: c.totalUstads,
      activeUstads: c.activeUstads,
      verifiedUstads: c.verifiedUstads,
      totalCustomers: c.totalCustomers,
      activeBookings: c.activeBookings,
      completedBookings: c.completedBookings,
      pendingJobs: c.pendingJobs,
      avgSla,
      topTrade: topTradeEntry ? topTradeEntry[0] : 'General Home Services',
      demandLevel,
    };
  });

  const summary = {
    totalWorkers: workers.filter((w: any) => w.isActive !== false).length,
    onlineWorkers: workers.filter((w: any) => w.isActive !== false && w.isAvailable).length,
    verifiedWorkers: workers.filter((w: any) => w.isActive !== false && w.isVerified).length,
    totalUsers: users.filter((u: any) => u.isActive !== false).length,
    activeBookings: bookings.filter((b: any) => ['pending', 'accepted', 'ongoing'].includes(b.status)).length,
    completedBookings: bookings.filter((b: any) => b.status === 'completed').length,
    openJobs: openJobs.length,
    totalBookings: bookings.length,
  };

  return successResponse(res, 200, 'Operations radar fetched successfully', {
    summary,
    cities,
    pins: {
      bookings: bookingPins,
      workers: workerPins,
      users: userPins,
      jobs: jobPins,
    },
  });
});
