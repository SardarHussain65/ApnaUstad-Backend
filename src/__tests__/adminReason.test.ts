import { describe, it, expect } from 'vitest';
import {
  findGuardRule,
  extractReason,
  checkReason,
} from '../utils/adminReason';

describe('adminReason guard rules', () => {
  it('finds guard rules for destructive mutation routes', () => {
    const userRule = findGuardRule('PATCH', '/users/671a1b2c3d4e5f6a7b8c9d0e/status');
    expect(userRule).toBeDefined();
    expect(userRule?.action).toBe('user:deactivate');

    const walletRule = findGuardRule('POST', '/wallets/671a1b2c3d4e5f6a7b8c9d0e/adjust');
    expect(walletRule).toBeDefined();
    expect(walletRule?.action).toBe('wallet:adjust');

    const disputeRule = findGuardRule('PATCH', '/disputes/671a1b2c3d4e5f6a7b8c9d0e/resolve');
    expect(disputeRule).toBeDefined();
    expect(disputeRule?.action).toBe('dispute:resolve');
  });

  it('correctly evaluates when a reason is required', () => {
    const userRule = findGuardRule('PATCH', '/users/123/status')!;
    expect(userRule.needsReason?.({ isActive: false })).toBe(true);
    expect(userRule.needsReason?.({ isActive: true })).toBe(false);
  });

  it('extracts reasons from body, query or legacy aliases', () => {
    expect(extractReason({ reason: 'Repeated cancellation' }, {})).toBe('Repeated cancellation');
    expect(extractReason({ description: 'Manual credit adjustment' }, {}, ['description'])).toBe('Manual credit adjustment');
    expect(extractReason({}, { reason: 'From query' })).toBe('From query');
  });

  it('validates minimum and maximum reason lengths', () => {
    expect(checkReason('', false)).toEqual({ ok: true, reason: '' });
    expect(checkReason('', true)).toEqual({ ok: false, message: 'A reason is required for this action' });
    expect(checkReason('bad', true)).toEqual({ ok: false, message: 'Reason must be at least 4 characters' });
    expect(checkReason('Valid reason provided for deactivation', true)).toEqual({
      ok: true,
      reason: 'Valid reason provided for deactivation',
    });
  });
});
