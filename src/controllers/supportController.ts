import { Response, Request } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { successResponse } from '../utils/ApiResponse';
import { helpTopics, helpArticles, supportChannels } from '../data/helpCenter';
import { SupportRequest } from '../models/SupportRequest';
import PushToken from '../models/PushToken';
import { sendMultiplePushNotifications } from '../services/fcmService';

const normalize = (value: string) => value.trim().toLowerCase();

export const getHelpTopics = asyncHandler(async (_req, res: Response) => {
  return successResponse(res, 200, 'Help topics fetched successfully', helpTopics);
});

export const getHelpArticles = asyncHandler(async (_req, res: Response) => {
  return successResponse(res, 200, 'Help articles fetched successfully', helpArticles);
});

export const searchHelpArticles = asyncHandler(async (req, res: Response) => {
  const query = typeof req.query.query === 'string' ? normalize(req.query.query) : '';

  if (!query) {
    return successResponse(res, 200, 'Help articles fetched successfully', helpArticles);
  }

  const results = helpArticles.filter((article) => {
    const haystack = [article.title, article.body, ...(article.tags || [])]
      .map((item) => normalize(String(item)))
      .join(' ');
    return haystack.includes(query);
  });

  return successResponse(res, 200, 'Help articles fetched successfully', results);
});

export const getSupportChannels = asyncHandler(async (_req, res: Response) => {
  return successResponse(res, 200, 'Support channels fetched successfully', supportChannels);
});

export const createSupportRequest = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, topic, subject, message, userId, metadata } = req.body;

  if (!message) {
    return successResponse(res, 400, 'Missing required field: message');
  }

  const doc = await SupportRequest.create({
    user: userId || undefined,
    name: name || 'Anonymous',
    email,
    topic: topic || subject || 'General',
    message,
    metadata,
  });

  return successResponse(res, 201, 'Support request created', doc);
});

export const listSupportRequests = asyncHandler(async (_req, res: Response) => {
  const docs = await SupportRequest.find().sort({ createdAt: -1 }).limit(200);
  return successResponse(res, 200, 'Support requests fetched', docs);
});

export const getSupportRequest = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id;
  const doc = await SupportRequest.findById(id);
  if (!doc) return successResponse(res, 404, 'Support request not found');
  return successResponse(res, 200, 'Support request fetched', doc);
});

export const getSupportRequestsByUser = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const docs = await SupportRequest.find({ user: userId }).sort({ createdAt: -1 });
  return successResponse(res, 200, 'Support requests fetched', docs);
});

export const replyToSupportRequest = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id;
  const { message, authorName } = req.body;
  if (!message) return successResponse(res, 400, 'Missing message');

  const doc = await SupportRequest.findById(id);
  if (!doc) return successResponse(res, 404, 'Support request not found');

  const reply = { from: 'admin' as const, message, authorName: authorName || 'Admin', createdAt: new Date() };
  doc.replies = doc.replies || [];
  doc.replies.push(reply as any);
  await doc.save();

  // Send push notifications to user's active devices (best-effort)
  try {
    if (doc.user) {
      const tokens = await (PushToken as any).findActiveForUser(String(doc.user));
      const deviceTokens = (tokens || []).map((t: any) => t.token).filter(Boolean);
      if (deviceTokens.length > 0) {
        await sendMultiplePushNotifications(deviceTokens, 'Support Reply', message, { supportId: String(doc._id) });
      }
    }
  } catch (notifyErr) {
    console.warn('Could not send support reply notification', notifyErr);
  }

  return successResponse(res, 200, 'Reply added', doc);
});
