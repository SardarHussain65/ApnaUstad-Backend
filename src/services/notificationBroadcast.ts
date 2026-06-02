import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import User from '../models/User';
import Worker from '../models/Workers';
import PushToken from '../models/PushToken';
import Notification from '../models/Notifications';
import { sendMultiplePushNotifications } from './fcmService';
import logger from '../config/logger';

export type BroadcastTarget = 'all' | 'users' | 'workers';

type Recipient = {
  id: mongoose.Types.ObjectId;
  type: 'user' | 'worker';
};

export type BroadcastRequest = {
  target: BroadcastTarget;
  title: string;
  body: string;
  type?: string;
};

export type BroadcastSummary = {
  broadcastId: string;
  target: BroadcastTarget;
  totalRecipients: number;
  withTokens: number;
  withoutTokens: number;
  notificationsCreated: number;
  push: {
    attempted: number;
    successCount: number;
    failureCount: number;
    invalidTokens: string[];
  };
};

const CHUNK_SIZE = 1000;

export const broadcastNotification = async (payload: BroadcastRequest): Promise<BroadcastSummary> => {
  const { target, title, body, type = 'general' } = payload;
  const broadcastId = uuidv4();

  const recipients: Recipient[] = [];

  if (target === 'users' || target === 'all') {
    const users = await User.find({ isActive: true }, { _id: 1 }).lean();
    users.forEach((user) => recipients.push({ id: user._id, type: 'user' }));
  }

  if (target === 'workers' || target === 'all') {
    const workers = await Worker.find({ isActive: true }, { _id: 1 }).lean();
    workers.forEach((worker) => recipients.push({ id: worker._id, type: 'worker' }));
  }

  const totalRecipients = recipients.length;

  if (totalRecipients === 0) {
    return {
      broadcastId,
      target,
      totalRecipients: 0,
      withTokens: 0,
      withoutTokens: 0,
      notificationsCreated: 0,
      push: {
        attempted: 0,
        successCount: 0,
        failureCount: 0,
        invalidTokens: [],
      },
    };
  }

  const recipientIds = recipients.map((recipient) => recipient.id);
  const pushDocs = await (PushToken as any).find({
    user: { $in: recipientIds },
    isActive: true,
  }).lean();

  const tokens = pushDocs.map((doc: any) => doc.token).filter(Boolean);
  const recipientsWithTokens = new Set(pushDocs.map((doc: any) => String(doc.user)));

  const withTokens = recipientsWithTokens.size;
  const withoutTokens = Math.max(0, totalRecipients - withTokens);

  const docs = recipients.map((recipient) => {
    const hasToken = recipientsWithTokens.has(String(recipient.id));
    return {
      recipient: recipient.id,
      recipientType: recipient.type,
      title,
      message: body,
      type,
      isRead: false,
      deliveryStatus: hasToken ? 'queued' : 'created',
      broadcastId,
    };
  });

  let notificationsCreated = 0;
  for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    const chunk = docs.slice(i, i + CHUNK_SIZE);
    await (Notification as any).insertMany(chunk, { ordered: false });
    notificationsCreated += chunk.length;
  }

  let pushResult = {
    attempted: tokens.length,
    successCount: 0,
    failureCount: 0,
    invalidTokens: [] as string[],
  };

  if (tokens.length > 0) {
    const result = await sendMultiplePushNotifications(tokens, title, body, {
      type: String(type),
      broadcastId,
      target,
    });

    pushResult = {
      attempted: tokens.length,
      successCount: result.successCount || 0,
      failureCount: result.failureCount || 0,
      invalidTokens: result.invalidTokens || [],
    };

    if (result.invalidTokens && result.invalidTokens.length > 0) {
      await (PushToken as any).updateMany(
        { token: { $in: result.invalidTokens } },
        { isActive: false }
      );
    }

    const statusUpdate: any = {
      deliveryStatus: result.success ? 'sent' : 'failed',
    };

    if (result.success) {
      statusUpdate.sentAt = new Date();
    } else if (result.error) {
      statusUpdate.error = String((result.error as any).message || result.error);
    }

    await (Notification as any).updateMany(
      { broadcastId, deliveryStatus: 'queued' },
      statusUpdate
    );
  }

  logger.info('Broadcast notification completed', {
    broadcastId,
    target,
    totalRecipients,
    withTokens,
    notificationsCreated,
    pushAttempted: pushResult.attempted,
  });

  return {
    broadcastId,
    target,
    totalRecipients,
    withTokens,
    withoutTokens,
    notificationsCreated,
    push: pushResult,
  };
};
