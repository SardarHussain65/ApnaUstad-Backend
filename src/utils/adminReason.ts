import { AdminAction } from '../config/adminActions';

/**
 * Declarative rules for admin mutations that require a written reason and/or a
 * granular action permission. Kept pure so it is unit-testable and so the guard
 * router stays a thin loop over this table.
 */
export interface GuardRule {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Path relative to `/api/v1/admin`. */
  pattern: RegExp;
  action?: AdminAction;
  /** Return true when this particular request needs a reason (default: always). */
  needsReason?: (body: Record<string, unknown>) => boolean;
  /** Legacy body keys the current UI may still send the reason under. */
  aliases?: string[];
  /** Audit action name when the guard itself records the attempt. */
  label: string;
}

export const MIN_REASON_LENGTH = 4;
export const MAX_REASON_LENGTH = 500;

export const GUARD_RULES: GuardRule[] = [
  {
    method: 'PATCH',
    pattern: /^\/users\/[^/]+\/status$/,
    action: 'user:deactivate',
    needsReason: (b) => b.isActive === false,
    label: 'user.status',
  },
  {
    method: 'PATCH',
    pattern: /^\/workers\/[^/]+\/status$/,
    action: 'worker:deactivate',
    needsReason: (b) => b.isActive === false,
    label: 'worker.status',
  },
  {
    method: 'PATCH',
    pattern: /^\/workers\/[^/]+\/verify$/,
    action: 'worker:verify',
    needsReason: (b) => b.isVerified === false,
    label: 'worker.verify',
  },
  {
    method: 'POST',
    pattern: /^\/wallets\/[^/]+\/adjust$/,
    action: 'wallet:adjust',
    aliases: ['description'],
    label: 'wallet.adjust',
  },
  {
    method: 'POST',
    pattern: /^\/wallets\/[^/]+\/recharge$/,
    action: 'wallet:recharge',
    needsReason: () => false,
    label: 'wallet.recharge',
  },
  {
    method: 'PATCH',
    pattern: /^\/wallet-topups\/[^/]+\/(approve|reject)$/,
    action: 'topup:review',
    needsReason: () => false,
    label: 'topup.review',
  },
  {
    method: 'PATCH',
    pattern: /^\/disputes\/[^/]+\/resolve$/,
    action: 'dispute:resolve',
    needsReason: (b) => b.status === 'resolved' || b.status === 'dismissed',
    aliases: ['adminNotes'],
    label: 'dispute.resolve',
  },
  {
    method: 'POST',
    pattern: /^\/bookings\/[^/]+\/cancel$/,
    action: 'booking:cancel',
    aliases: ['cancelReason'],
    label: 'booking.cancel',
  },
  {
    method: 'PATCH',
    pattern: /^\/jobs\/[^/]+\/cancel$/,
    action: 'booking:cancel',
    label: 'job.cancel',
  },
  {
    method: 'PATCH',
    pattern: /^\/jobs\/[^/]+\/status$/,
    action: 'booking:cancel',
    needsReason: (b) => b.status === 'cancelled',
    label: 'job.status',
  },
  {
    method: 'DELETE',
    pattern: /^\/reviews\/[^/]+$/,
    action: 'review:moderate',
    label: 'review.delete',
  },
  {
    method: 'POST',
    pattern: /^\/notifications\/global$/,
    action: 'broadcast:send',
    needsReason: () => false,
    label: 'broadcast.send',
  },
  {
    method: 'PATCH',
    pattern: /^\/(platform-settings|wallet-settings|wallet-payment-methods)$/,
    action: 'settings:write',
    needsReason: () => false,
    label: 'settings.write',
  },
];

export const findGuardRule = (method: string, path: string): GuardRule | undefined =>
  GUARD_RULES.find((rule) => rule.method === method.toUpperCase() && rule.pattern.test(path));

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Picks the reason out of `body.reason`, query, or any legacy alias. */
export const extractReason = (
  body: Record<string, unknown> | undefined,
  query: Record<string, unknown> | undefined,
  aliases: string[] = []
): string => {
  const keys = ['reason', ...aliases];
  for (const key of keys) {
    const fromBody = asTrimmedString(body?.[key]);
    if (fromBody) return fromBody;
  }
  return asTrimmedString(query?.reason);
};

export type ReasonCheck = { ok: true; reason: string } | { ok: false; message: string };

export const checkReason = (reason: string, required: boolean): ReasonCheck => {
  if (!reason) {
    return required ? { ok: false, message: 'A reason is required for this action' } : { ok: true, reason: '' };
  }
  if (reason.length < MIN_REASON_LENGTH) {
    return { ok: false, message: `Reason must be at least ${MIN_REASON_LENGTH} characters` };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, message: `Reason must be at most ${MAX_REASON_LENGTH} characters` };
  }
  return { ok: true, reason };
};
