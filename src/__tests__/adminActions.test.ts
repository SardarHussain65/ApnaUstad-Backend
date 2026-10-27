import { describe, it, expect } from 'vitest';
import {
  getActionsForRole,
  canPerform,
  ALL_ADMIN_ACTIONS,
} from '../config/adminActions';

describe('adminActions RBAC', () => {
  it('grants all actions to superadmin', () => {
    const actions = getActionsForRole('superadmin');
    expect(actions).toEqual([...ALL_ADMIN_ACTIONS]);
    expect(canPerform('superadmin', 'wallet:adjust')).toBe(true);
    expect(canPerform('superadmin', 'cnic:reveal')).toBe(true);
  });

  it('restricts verifier role to verification and cnic reveal', () => {
    expect(canPerform('verifier', 'worker:verify')).toBe(true);
    expect(canPerform('verifier', 'cnic:reveal')).toBe(true);
    expect(canPerform('verifier', 'wallet:adjust')).toBe(false);
    expect(canPerform('verifier', 'job:delete')).toBe(false);
  });

  it('restricts finance role to wallet operations and exports', () => {
    expect(canPerform('finance', 'wallet:recharge')).toBe(true);
    expect(canPerform('finance', 'wallet:adjust')).toBe(true);
    expect(canPerform('finance', 'export:data')).toBe(true);
    expect(canPerform('finance', 'user:deactivate')).toBe(false);
  });
});
