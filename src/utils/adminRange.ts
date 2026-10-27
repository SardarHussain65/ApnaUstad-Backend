import { BadRequestError } from './ApiError';

/**
 * Date-range helpers for admin analytics. Pakistan has no DST (UTC+5), so a fixed
 * offset keeps "a day" consistent with MongoDB's `timezone: 'Asia/Karachi'` grouping.
 */
export const ADMIN_TZ = 'Asia/Karachi';
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_RANGE_DAYS = 366;

export type Interval = 'day' | 'week' | 'month';

export interface DateRange {
  /** Inclusive start (start of the first PKT day). */
  from: Date;
  /** Exclusive end (start of the PKT day after the last day). */
  to: Date;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** PKT calendar-day key (`YYYY-MM-DD`) for an instant. */
export const dayKey = (date: Date): string => new Date(date.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);

/** Start of a PKT day as an instant. */
export const startOfDayFromKey = (key: string): Date => new Date(Date.parse(`${key}T00:00:00Z`) - PKT_OFFSET_MS);

const parseDayInput = (value: string, label: string): Date => {
  if (DAY_KEY.test(value)) {
    const d = startOfDayFromKey(value);
    if (Number.isNaN(d.getTime())) throw new BadRequestError(`Invalid ${label}`);
    return d;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestError(`Invalid ${label}`);
  return startOfDayFromKey(dayKey(parsed));
};

/**
 * Resolves `?from=YYYY-MM-DD&to=YYYY-MM-DD` (both inclusive days, PKT) into a half-open range.
 * Defaults to the trailing `defaultDays` days ending today.
 */
export const parseRange = (
  from?: unknown,
  to?: unknown,
  now: Date = new Date(),
  defaultDays = 30
): DateRange => {
  const todayStart = startOfDayFromKey(dayKey(now));
  const toDay = typeof to === 'string' && to ? parseDayInput(to, 'to') : todayStart;
  const end = new Date(toDay.getTime() + DAY_MS);
  const start =
    typeof from === 'string' && from
      ? parseDayInput(from, 'from')
      : new Date(end.getTime() - defaultDays * DAY_MS);

  if (start.getTime() >= end.getTime()) throw new BadRequestError('`from` must be on or before `to`');
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  if (days > MAX_RANGE_DAYS) throw new BadRequestError(`Range cannot exceed ${MAX_RANGE_DAYS} days`);
  return { from: start, to: end };
};

export const rangeDays = (range: DateRange): number =>
  Math.round((range.to.getTime() - range.from.getTime()) / DAY_MS);

/** Equal-length window immediately preceding `range`. */
export const previousRange = (range: DateRange): DateRange => {
  const length = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - length), to: new Date(range.from.getTime()) };
};

/** Every PKT day key in the range (used to zero-fill gaps). */
export const dayKeys = (range: DateRange): string[] => {
  const keys: string[] = [];
  for (let t = range.from.getTime(); t < range.to.getTime(); t += DAY_MS) {
    keys.push(dayKey(new Date(t)));
  }
  return keys;
};

const addDays = (key: string, delta: number): string =>
  new Date(Date.parse(`${key}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);

/** Bucket key for a day: itself, its ISO week's Monday, or the first of its month. */
export const bucketKey = (key: string, interval: Interval): string => {
  if (interval === 'day') return key;
  if (interval === 'month') return `${key.slice(0, 7)}-01`;
  const dow = new Date(`${key}T00:00:00Z`).getUTCDay();
  return addDays(key, -((dow + 6) % 7));
};

export interface SeriesPoint {
  date: string;
  value: number;
}

/** Zero-filled daily series from sparse `{key -> value}` rows. */
export const fillDaily = (range: DateRange, rows: Map<string, number>): SeriesPoint[] =>
  dayKeys(range).map((date) => ({ date, value: rows.get(date) ?? 0 }));

/** Rolls a daily series up into week/month buckets (stable order, zero-filled by construction). */
export const rollup = (daily: SeriesPoint[], interval: Interval): SeriesPoint[] => {
  if (interval === 'day') return daily;
  const buckets = new Map<string, number>();
  for (const point of daily) {
    const key = bucketKey(point.date, interval);
    buckets.set(key, (buckets.get(key) ?? 0) + point.value);
  }
  return [...buckets.entries()].map(([date, value]) => ({ date, value }));
};

/**
 * Percent change vs previous. `null` when previous is 0 so the UI can show "New"/"—"
 * instead of a fake +100%.
 */
export const computeDeltaPct = (current: number, previous: number): number | null => {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
};

export const parseInterval = (value: unknown, days: number): Interval => {
  if (value === 'day' || value === 'week' || value === 'month') return value;
  if (days > 180) return 'month';
  if (days > 60) return 'week';
  return 'day';
};
