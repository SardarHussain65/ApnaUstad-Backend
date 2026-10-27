import type { Model } from 'mongoose';
import User from '../models/User';
import Worker from '../models/Workers';
import Booking from '../models/Booking';
import Payment from '../models/Payment';
import JobPost from '../models/JobPost';
import Dispute from '../models/Dispute';
import WalletTopUpRequest from '../models/WalletTopUpRequest';
import SupportRequest from '../models/SupportRequest';
import VerificationRequest from '../models/VerificationRequest';
import {
  ADMIN_TZ,
  DateRange,
  Interval,
  SeriesPoint,
  computeDeltaPct,
  dayKeys,
  fillDaily,
  previousRange,
  rollup,
} from '../utils/adminRange';

/**
 * Metric catalogue for the admin dashboard. Each metric is a single `$group` by PKT day,
 * so any metric can be summarised, compared with the previous period, sparklined or charted
 * through the same code path.
 */
export type MetricKey =
  | 'revenue'
  | 'commission'
  | 'bookings'
  | 'completedBookings'
  | 'cancelledBookings'
  | 'jobs'
  | 'newUsers'
  | 'newWorkers'
  | 'topupVolume'
  | 'disputes';

interface MetricDef {
  model: Model<any>;
  /** Mongo expression for the event time of a row. */
  dateExpr: string | Record<string, unknown>;
  /** Builds the `$match` for a window (must make the date field filterable). */
  match: (window: DateRange) => Record<string, unknown>;
  /** Field to sum; omit to count rows. */
  sumField?: string;
  unit: 'count' | 'pkr';
}

const between = (field: string, w: DateRange) => ({ [field]: { $gte: w.from, $lt: w.to } });

/** Rows without `paidAt` (legacy) fall back to `createdAt`. */
const paidWindow = (w: DateRange) => ({
  status: 'paid',
  $or: [between('paidAt', w), { paidAt: null, ...between('createdAt', w) }],
});

export const METRICS: Record<MetricKey, MetricDef> = {
  revenue: {
    model: Payment as Model<any>,
    dateExpr: { $ifNull: ['$paidAt', '$createdAt'] },
    match: paidWindow,
    sumField: '$amount',
    unit: 'pkr',
  },
  commission: {
    model: Payment as Model<any>,
    dateExpr: { $ifNull: ['$paidAt', '$createdAt'] },
    match: paidWindow,
    sumField: '$platformFee',
    unit: 'pkr',
  },
  bookings: {
    model: Booking as Model<any>,
    dateExpr: '$createdAt',
    match: (w) => between('createdAt', w),
    unit: 'count',
  },
  completedBookings: {
    model: Booking as Model<any>,
    dateExpr: { $ifNull: ['$completedAt', '$updatedAt'] },
    match: (w) => ({
      status: 'completed',
      $or: [between('completedAt', w), { completedAt: null, ...between('updatedAt', w) }],
    }),
    unit: 'count',
  },
  cancelledBookings: {
    model: Booking as Model<any>,
    dateExpr: '$updatedAt',
    match: (w) => ({ status: 'cancelled', ...between('updatedAt', w) }),
    unit: 'count',
  },
  jobs: {
    model: JobPost as Model<any>,
    dateExpr: '$createdAt',
    match: (w) => between('createdAt', w),
    unit: 'count',
  },
  newUsers: {
    model: User as Model<any>,
    dateExpr: '$createdAt',
    match: (w) => between('createdAt', w),
    unit: 'count',
  },
  newWorkers: {
    model: Worker as Model<any>,
    dateExpr: '$createdAt',
    match: (w) => between('createdAt', w),
    unit: 'count',
  },
  topupVolume: {
    model: WalletTopUpRequest as Model<any>,
    dateExpr: { $ifNull: ['$approvedAt', '$createdAt'] },
    match: (w) => ({
      status: 'approved',
      $or: [between('approvedAt', w), { approvedAt: null, ...between('createdAt', w) }],
    }),
    sumField: '$amount',
    unit: 'pkr',
  },
  disputes: {
    model: Dispute as Model<any>,
    dateExpr: '$createdAt',
    match: (w) => between('createdAt', w),
    unit: 'count',
  },
};

export const isMetricKey = (value: string): value is MetricKey => value in METRICS;

/** Sparse `{ 'YYYY-MM-DD' -> value }` for a window (single indexed aggregation). */
export const aggregateDaily = async (metric: MetricKey, window: DateRange): Promise<Map<string, number>> => {
  const def = METRICS[metric];
  const rows: Array<{ _id: string; value: number }> = await def.model.aggregate([
    { $match: def.match(window) },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: def.dateExpr, timezone: ADMIN_TZ } },
        value: def.sumField ? { $sum: def.sumField } : { $sum: 1 },
      },
    },
  ]);
  return new Map(rows.map((row) => [row._id, row.value ?? 0]));
};

export const dailySeries = async (metric: MetricKey, range: DateRange): Promise<SeriesPoint[]> =>
  fillDaily(range, await aggregateDaily(metric, range));

const sum = (points: SeriesPoint[]) => points.reduce((acc, p) => acc + p.value, 0);

export interface MetricSummary {
  current: number;
  previous: number | null;
  deltaPct: number | null;
  unit: 'count' | 'pkr' | 'percent';
  sparkline: number[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Summary of every dashboard metric for `range`, optionally compared with the preceding
 * window of equal length. All metrics run in parallel; each is one `$group`.
 */
export const getDashboardSummary = async (range: DateRange, compare: boolean) => {
  const prev = previousRange(range);
  const keys = Object.keys(METRICS) as MetricKey[];

  const entries = await Promise.all(
    keys.map(async (key) => {
      const [cur, before] = await Promise.all([
        dailySeries(key, range),
        compare ? dailySeries(key, prev) : Promise.resolve<SeriesPoint[]>([]),
      ]);
      return [key, { cur, before }] as const;
    })
  );

  const series = Object.fromEntries(entries) as Record<MetricKey, { cur: SeriesPoint[]; before: SeriesPoint[] }>;
  const metrics = {} as Record<string, MetricSummary>;

  for (const key of keys) {
    const { cur, before } = series[key];
    const current = round2(sum(cur));
    const previous = compare ? round2(sum(before)) : null;
    metrics[key] = {
      current,
      previous,
      deltaPct: previous === null ? null : computeDeltaPct(current, previous),
      unit: METRICS[key].unit,
      sparkline: cur.map((p) => round2(p.value)),
    };
  }

  // Derived: cancellation rate (% of bookings created in the window that are cancelled).
  const rate = (cancelled: number, total: number) => (total ? round2((cancelled / total) * 100) : 0);
  const curCancelled = metrics.cancelledBookings?.current ?? 0;
  const curBookings = metrics.bookings?.current ?? 0;
  const curRate = rate(curCancelled, curBookings);
  const prevCancelled = metrics.cancelledBookings?.previous ?? 0;
  const prevBookings = metrics.bookings?.previous ?? 0;
  const prevRate = compare ? rate(prevCancelled, prevBookings) : null;
  metrics.cancellationRate = {
    current: curRate,
    previous: prevRate,
    deltaPct: prevRate === null ? null : computeDeltaPct(curRate, prevRate),
    unit: 'percent',
    sparkline: series.bookings.cur.map((p, i) => rate(series.cancelledBookings.cur[i]?.value ?? 0, p.value)),
  };

  return {
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      days: dayKeys(range).length,
      previousFrom: compare ? prev.from.toISOString() : null,
      previousTo: compare ? prev.to.toISOString() : null,
      timezone: ADMIN_TZ,
    },
    compare,
    metrics,
  };
};

export const getTimeseries = async (metricKeys: MetricKey[], range: DateRange, interval: Interval) => {
  const dailies = await Promise.all(metricKeys.map((key) => dailySeries(key, range)));
  const rolled = dailies.map((daily) => rollup(daily, interval));
  const dates = rolled[0]?.map((p) => p.date) ?? [];

  const points = dates.map((date, i) => {
    const point: Record<string, number | string> = { date };
    metricKeys.forEach((key, k) => {
      const r = rolled[k];
      point[key] = round2(r?.[i]?.value ?? 0);
    });
    return point;
  });

  const totals = Object.fromEntries(metricKeys.map((key, k) => [key, round2(sum(dailies[k] || []))]));
  return { interval, timezone: ADMIN_TZ, metrics: metricKeys, points, totals };
};

/**
 * Open work items for the sidebar badges + Action Center. One round-trip replaces the eight
 * `limit=1` list queries the UI used to issue.
 */
export const getActionCounts = async () => {
  const [
    openTickets,
    openJobs,
    pendingBookings,
    unverifiedWorkers,
    pendingTopUps,
    openDisputes,
    underReviewDisputes,
    pendingVerifications,
    specialtyAgg,
  ] = await Promise.all([
    SupportRequest.countDocuments({ status: 'open' }),
    JobPost.countDocuments({ status: 'open' }),
    Booking.countDocuments({ status: 'pending' }),
    Worker.countDocuments({ isVerified: false, isActive: true }),
    WalletTopUpRequest.countDocuments({ status: 'pending' }),
    Dispute.countDocuments({ status: 'open' }),
    Dispute.countDocuments({ status: 'under_review' }),
    VerificationRequest.countDocuments({ status: 'pending' }),
    Worker.aggregate([
      { $match: { 'specialties.approvalStatus': 'pending' } },
      { $unwind: '$specialties' },
      { $match: { 'specialties.approvalStatus': 'pending' } },
      { $count: 'n' },
    ]),
  ]);

  return {
    openTickets,
    openJobs,
    pendingBookings,
    unverifiedWorkers,
    pendingTopUps,
    openDisputes,
    underReviewDisputes,
    pendingVerifications,
    pendingSpecialties: specialtyAgg[0]?.n ?? 0,
    generatedAt: new Date().toISOString(),
  };
};

export type ActionCounts = Awaited<ReturnType<typeof getActionCounts>>;

type SocketEmitter = (event: string, data: any) => void;
let adminSocketEmitter: SocketEmitter | null = null;

export const setAdminSocketEmitter = (emitter: SocketEmitter) => {
  adminSocketEmitter = emitter;
};

export const broadcastActionCounts = async () => {
  try {
    if (adminSocketEmitter) {
      const counts = await getActionCounts();
      adminSocketEmitter('admin:counts', counts);
    }
  } catch {
    // Socket not yet initialized or error; safe to ignore
  }
};
