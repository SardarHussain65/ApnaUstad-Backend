import { AdminRole } from './adminPermissions';

/**
 * Granular, action-level RBAC. Complements the coarse page-level `AdminPermission`
 * list in `adminPermissions.ts`: a role may be able to *see* wallets (page permission)
 * without being allowed to *adjust* them (action).
 *
 * Single source of truth: `GET /admin/me` exposes the resolved list so the admin UI
 * never has to duplicate this map.
 */
export type AdminAction =
  | 'user:deactivate'
  | 'worker:deactivate'
  | 'worker:verify'
  | 'cnic:reveal'
  | 'job:delete'
  | 'booking:cancel'
  | 'dispute:resolve'
  | 'review:moderate'
  | 'wallet:recharge'
  | 'wallet:adjust'
  | 'topup:review'
  | 'settings:write'
  | 'broadcast:send'
  | 'export:data'
  | 'admin:manage';

export const ALL_ADMIN_ACTIONS: readonly AdminAction[] = [
  'user:deactivate',
  'worker:deactivate',
  'worker:verify',
  'cnic:reveal',
  'job:delete',
  'booking:cancel',
  'dispute:resolve',
  'review:moderate',
  'wallet:recharge',
  'wallet:adjust',
  'topup:review',
  'settings:write',
  'broadcast:send',
  'export:data',
  'admin:manage',
];

export const ROLE_ACTIONS: Record<AdminRole, readonly (AdminAction | '*')[]> = {
  superadmin: ['*'],
  admin: [
    'user:deactivate',
    'worker:deactivate',
    'worker:verify',
    'cnic:reveal',
    'job:delete',
    'booking:cancel',
    'dispute:resolve',
    'review:moderate',
    'wallet:recharge',
    'wallet:adjust',
    'topup:review',
    'settings:write',
    'broadcast:send',
    'export:data',
  ],
  support: ['user:deactivate', 'booking:cancel', 'dispute:resolve', 'review:moderate', 'broadcast:send'],
  verifier: ['worker:verify', 'worker:deactivate', 'cnic:reveal'],
  finance: ['wallet:recharge', 'wallet:adjust', 'topup:review', 'export:data'],
};

export const getActionsForRole = (role: string): AdminAction[] => {
  const actions = ROLE_ACTIONS[role as AdminRole];
  if (!actions) return [];
  if (actions.includes('*')) return [...ALL_ADMIN_ACTIONS];
  return [...(actions as AdminAction[])];
};

export const canPerform = (role: string, action: AdminAction): boolean =>
  getActionsForRole(role).includes(action);
