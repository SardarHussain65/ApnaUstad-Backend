import AdminAuditLog from '../models/AdminAuditLog';
import { asyncHandler } from '../utils/asyncHandler';
import { successResponse } from '../utils/ApiResponse';
import { AdminAuthRequest } from '../middlewares/admin.middleware';

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getAuditLogs = asyncHandler(async (req: AdminAuthRequest, res) => {
  const parsedPage = parseInt(req.query.page as string, 10);
  const parsedLimit = parseInt(req.query.limit as string, 10);
  const page = Number.isNaN(parsedPage) ? 1 : Math.max(parsedPage, 1);
  const limit = Number.isNaN(parsedLimit) ? 50 : Math.min(Math.max(parsedLimit, 1), 200);

  const action = req.query.action as string | undefined;
  const entityType = req.query.entityType as string | undefined;
  const entityId = req.query.entityId as string | undefined;
  const actorId = req.query.actorId as string | undefined;
  const search = req.query.search as string | undefined;

  const query: Record<string, any> = {};
  if (action) query.action = action;
  if (entityType) query.entityType = entityType;
  if (entityId) query.entityId = entityId;
  if (actorId) query.actor = actorId;

  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    query.$or = [
      { action: regex },
      { entityType: regex },
      { entityId: regex },
      { reason: regex },
    ];
  }

  const total = await AdminAuditLog.countDocuments(query);
  const logs = await AdminAuditLog.find(query)
    .populate('actor', 'fullName email role')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  return successResponse(res, 200, 'Audit logs fetched successfully', {
    logs,
    pagination: {
      total,
      page,
      pages: Math.ceil(total / limit),
    },
  });
});
