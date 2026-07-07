import { Response, Request } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { successResponse, paginatedResponse } from '../utils/ApiResponse';
import { helpTopics, helpArticles, supportChannels } from '../data/helpCenter';
import { SupportRequest } from '../models/SupportRequest';
import PushToken from '../models/PushToken';
import { sendMultiplePushNotifications } from '../services/fcmService';
import {
  sendSupportRequestConfirmation,
  sendSupportRequestAdminAlert,
  sendSupportReplyNotification
} from '../services/emailService';

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

  // Trigger background emails without blocking the response
  if (email) {
    sendSupportRequestConfirmation(email, name || 'User', topic || subject || 'General', message, String(doc._id))
      .catch((err) => console.error('Failed to send support confirmation email:', err));
  }

  sendSupportRequestAdminAlert(name || 'Anonymous', email || '', topic || subject || 'General', message, String(doc._id))
    .catch((err) => console.error('Failed to send admin support alert email:', err));

  return successResponse(res, 201, 'Support request created', doc);
});

export const listSupportRequests = asyncHandler(async (req: Request, res: Response) => {
  const { status, search, priority } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20));
  const filter: any = {};

  if (status) {
    filter.status = status;
  }

  if (priority) {
    filter.priority = priority;
  }

  if (search) {
    const searchRegex = new RegExp(String(search), 'i');
    filter.$or = [
      { name: searchRegex },
      { email: searchRegex },
      { topic: searchRegex },
      { message: searchRegex },
    ];
  }

  const [docs, total] = await Promise.all([
    SupportRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    SupportRequest.countDocuments(filter),
  ]);
  return paginatedResponse(res, 200, 'Support requests fetched', docs, page, limit, total);
});

export const getSupportRequest = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id;
  const doc = await SupportRequest.findById(id);
  if (!doc) return successResponse(res, 404, 'Support request not found');
  return successResponse(res, 200, 'Support request fetched', doc);
});

export const getSupportRequestsByUser = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const docs = await SupportRequest.find({ user: userId as string }).sort({ createdAt: -1 });
  return successResponse(res, 200, 'Support requests fetched', docs);
});

export const replyToSupportRequest = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id;
  const { message, authorName, from = 'admin' } = req.body;
  if (!message) return successResponse(res, 400, 'Missing message');

  const doc = await SupportRequest.findById(id);
  if (!doc) return successResponse(res, 404, 'Support request not found');

  const reply = { 
    from: (from === 'user' ? 'user' : 'admin') as 'user' | 'admin', 
    message, 
    authorName: authorName || (from === 'user' ? 'User' : 'Admin'), 
    createdAt: new Date() 
  };
  doc.replies = doc.replies || [];
  doc.replies.push(reply as any);

  if (from === 'user') {
    doc.status = 'open'; // Reopen ticket when user replies
  }
  await doc.save();

  // Send push notifications to user's active devices (only if reply is from admin)
  if (from === 'admin') {
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

    // Send support reply notification email
    if (doc.email) {
      const replyIndex = doc.replies.length - 1;
      const replyId = `${doc._id}-reply-${replyIndex}`;
      sendSupportReplyNotification(doc.email, doc.name || 'User', doc.message, message, replyId)
        .catch((err) => console.error('Failed to send support reply email:', err));
    }
  }

  return successResponse(res, 200, 'Reply added', doc);
});

export const updateSupportStatus = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id;
  const { status } = req.body;

  if (!['open', 'closed', 'pending'].includes(status)) {
    return successResponse(res, 400, 'Invalid status value');
  }

  const doc = await SupportRequest.findById(id);
  if (!doc) return successResponse(res, 404, 'Support request not found');

  doc.status = status;
  await doc.save();

  return successResponse(res, 200, 'Support request status updated', doc);
});

export const updateSupportPriority = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id;
  const { priority } = req.body;

  if (!['low', 'medium', 'high', 'urgent'].includes(priority)) {
    return successResponse(res, 400, 'Invalid priority value');
  }

  const doc = await SupportRequest.findById(id);
  if (!doc) return successResponse(res, 404, 'Support request not found');

  doc.priority = priority;
  await doc.save();

  return successResponse(res, 200, 'Support request priority updated', doc);
});
