export type AdminRole = 'superadmin' | 'admin' | 'support' | 'verifier' | 'finance';

export type AdminPermission =
  | 'dashboard'
  | 'reports'
  | 'users'
  | 'workers'
  | 'onboarding'
  | 'verification'
  | 'specialty-requests'
  | 'jobs'
  | 'bookings'
  | 'payments'
  | 'wallets'
  | 'categories'
  | 'promos'
  | 'reviews'
  | 'notifications'
  | 'support'
  | 'disputes'
  | 'audit'
  | 'admins'
  | 'settings'
  | 'platform-config';

const ALL_PERMISSIONS: AdminPermission[] = [
  'dashboard',
  'reports',
  'users',
  'workers',
  'onboarding',
  'verification',
  'specialty-requests',
  'jobs',
  'bookings',
  'payments',
  'wallets',
  'categories',
  'promos',
  'reviews',
  'notifications',
  'support',
  'disputes',
  'audit',
  'admins',
  'settings',
  'platform-config',
];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly (AdminPermission | '*')[]> = {
  superadmin: ['*'],
  admin: ['*'],
  support: ['dashboard', 'users', 'bookings', 'support', 'disputes', 'notifications', 'settings'],
  verifier: ['dashboard', 'workers', 'onboarding', 'verification', 'specialty-requests', 'settings'],
  finance: ['dashboard', 'reports', 'payments', 'wallets', 'promos', 'bookings', 'settings'],
};

export const hasAdminPermission = (role: string, permission: AdminPermission): boolean => {
  const permissions = ROLE_PERMISSIONS[role as AdminRole];
  if (!permissions) return false;
  if (permissions.includes('*' as const)) return true;
  return (permissions as AdminPermission[]).includes(permission);
};

export const getPermissionsForRole = (role: string): AdminPermission[] => {
  const permissions = ROLE_PERMISSIONS[role as AdminRole];
  if (!permissions) return [];
  if (permissions.includes('*' as const)) return ALL_PERMISSIONS;
  return [...permissions] as AdminPermission[];
};
