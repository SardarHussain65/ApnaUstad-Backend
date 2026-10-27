import { describe, it, expect } from 'vitest';
import {
  parseRange,
  rangeDays,
  previousRange,
  dayKeys,
  dayKey,
  bucketKey,
  fillDaily,
  rollup,
  computeDeltaPct,
  parseInterval,
  startOfDayFromKey,
} from '../utils/adminRange';

describe('adminRange utils', () => {
  it('converts instant to PKT calendar day key', () => {
    // 2026-10-27 19:30:00 UTC is 2026-10-28 00:30:00 PKT (UTC+5)
    const d = new Date(Date.parse('2026-10-27T19:30:00Z'));
    expect(dayKey(d)).toBe('2026-10-28');
  });

  it('computes PKT start of day instant', () => {
    const d = startOfDayFromKey('2026-10-28');
    // PKT 00:00:00 is UTC 2026-10-27 19:00:00
    expect(d.toISOString()).toBe('2026-10-27T19:00:00.000Z');
  });

  it('parses valid range and computes days', () => {
    const range = parseRange('2026-10-01', '2026-10-07');
    expect(rangeDays(range)).toBe(7);
    const keys = dayKeys(range);
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe('2026-10-01');
    expect(keys[6]).toBe('2026-10-07');
  });

  it('computes contiguous previous range of exact same length', () => {
    const current = parseRange('2026-10-08', '2026-10-14');
    const prev = previousRange(current);
    expect(rangeDays(prev)).toBe(7);
    expect(prev.to.getTime()).toBe(current.from.getTime());
    const prevKeys = dayKeys(prev);
    expect(prevKeys[0]).toBe('2026-10-01');
    expect(prevKeys[6]).toBe('2026-10-07');
  });

  it('zero-fills daily series when database rows are sparse', () => {
    const range = parseRange('2026-10-01', '2026-10-03');
    const sparse = new Map<string, number>([['2026-10-02', 1500]]);
    const daily = fillDaily(range, sparse);
    expect(daily).toEqual([
      { date: '2026-10-01', value: 0 },
      { date: '2026-10-02', value: 1500 },
      { date: '2026-10-03', value: 0 },
    ]);
  });

  it('rolls up daily points into week or month buckets', () => {
    const range = parseRange('2026-10-01', '2026-10-04');
    const daily = fillDaily(range, new Map([['2026-10-01', 10], ['2026-10-02', 20], ['2026-10-03', 30]]));
    const rolled = rollup(daily, 'month');
    expect(rolled).toHaveLength(1);
    expect(rolled[0]).toEqual({ date: '2026-10-01', value: 60 });
  });

  it('computes delta percentage or returns null when previous is 0', () => {
    expect(computeDeltaPct(150, 100)).toBe(50);
    expect(computeDeltaPct(80, 100)).toBe(-20);
    expect(computeDeltaPct(100, 0)).toBeNull(); // Avoid fake +100%
  });

  it('picks interval intelligently based on day count', () => {
    expect(parseInterval(undefined, 14)).toBe('day');
    expect(parseInterval(undefined, 90)).toBe('week');
    expect(parseInterval(undefined, 200)).toBe('month');
    expect(parseInterval('day', 200)).toBe('day');
  });
});
