import AdminAuditLog from '../models/AdminAuditLog';
import logger from '../config/logger';
import { AdminAuthRequest } from '../middlewares/admin.middleware';

export type AdminAuditPayload = {
  action: string;
  entityType: string;
  entityId?: string;
  reason?: string;
  metadata?: Record<string, any>;
};

const normalizeReason = (reason?: string) => {
  if (!reason) return '';
  const trimmed = reason.trim();
  if (trimmed.length > 500) return trimmed.slice(0, 500);
  return trimmed;
};

export const recordAdminAction = async (req: AdminAuthRequest, payload: AdminAuditPayload) => {
  try {
    if (!req.admin) return;

    const reason = normalizeReason(payload.reason);

    await AdminAuditLog.create({
      actor: req.admin._id,
      actorRole: req.admin.role,
      action: payload.action,
      entityType: payload.entityType,
      entityId: payload.entityId,
      reason,
      metadata: payload.metadata || {},
      ip: req.ip || '',
      userAgent: req.get('user-agent') || '',
    });
  } catch (error: any) {
    logger.warn('Failed to record admin audit log', {
      action: payload.action,
      entityType: payload.entityType,
      entityId: payload.entityId,
      error: error?.message || error,
    });
  }
};
