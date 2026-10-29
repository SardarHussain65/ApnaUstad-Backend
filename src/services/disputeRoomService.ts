// src/services/disputeRoomService.ts
// Case Room logic: 3-way messaging, stored history timeline, unread tracking and real-time events.
import mongoose from 'mongoose';
import Dispute, {
  type IDispute,
  type DisputePartyType,
  type IDisputeTimelineEvent,
  type DisputeOutcome,
} from '../models/Dispute';
import DisputeMessage, { type IDisputeMessage } from '../models/DisputeMessage';
import User from '../models/User';
import Worker from '../models/Workers';
import { getIO } from '../sockets/socketManager';
import { sendNotificationToRecipient } from './notificationHelper';
import { DISPUTE_REASON_LABELS } from './disputeService';
import logger from '../config/logger';

export const CLOSED_DISPUTE_STATUSES = ['resolved', 'dismissed', 'withdrawn'] as const;
export const DISPUTE_MESSAGE_MAX_LENGTH = 1000;
export const DISPUTE_MESSAGE_MAX_ATTACHMENTS = 3;
const NOTIFY_THROTTLE_MS = 10 * 60 * 1000;

export type DisputeViewerRole = 'customer' | 'worker' | 'admin';
export type DisputePhase = 'reported' | 'checking' | 'closed';

export const isDisputeClosed = (status?: string | null) =>
  CLOSED_DISPUTE_STATUSES.includes(status as typeof CLOSED_DISPUTE_STATUSES[number]);

export const getDisputePhase = (status?: string | null): DisputePhase => {
  if (isDisputeClosed(status)) return 'closed';
  if (status === 'under_review') return 'checking';
  return 'reported';
};

/** Derive outcome for legacy disputes that were closed before `outcome` existed. */
export const deriveDisputeOutcome = (dispute: Pick<IDispute, 'status' | 'outcome'>): DisputeOutcome | null => {
  if (dispute.outcome) return dispute.outcome;
  if (dispute.status === 'resolved') return 'customer_favor';
  if (dispute.status === 'dismissed') return 'worker_favor';
  if (dispute.status === 'withdrawn') return 'settled';
  return null;
};

export const getOutcomeLabel = (outcome: DisputeOutcome | null) => {
  switch (outcome) {
    case 'customer_favor': return 'Customer favoured';
    case 'worker_favor': return 'Ustad cleared';
    case 'settled': return 'Settled by both sides';
    default: return '';
  }
};

const idOf = (value: any): string => String(value?._id ?? value ?? '');

/** Determine which side of the dispute the authenticated mobile user is on. */
export const getViewerRole = (dispute: IDispute, userId?: string): DisputeViewerRole | null => {
  if (!userId) return null;
  if (idOf(dispute.customer) === userId) return 'customer';
  if (idOf(dispute.worker) === userId) return 'worker';
  return null;
};

export const resolvePartyName = async (type: DisputePartyType, id?: string | mongoose.Types.ObjectId | null) => {
  if (!id) return type === 'admin' ? 'ApnaUstad Team' : '';
  try {
    if (type === 'customer') {
      const user = await User.findById(id).select('fullName').lean<{ fullName?: string }>();
      return user?.fullName || 'Customer';
    }
    if (type === 'worker') {
      const worker = await Worker.findById(id).select('fullName').lean<{ fullName?: string }>();
      return worker?.fullName || 'Ustad';
    }
  } catch {
    // fall through to generic label
  }
  return type === 'admin' ? 'ApnaUstad Team' : '';
};

export const pushTimelineEvent = (
  dispute: IDispute,
  event: Omit<IDisputeTimelineEvent, 'at'> & { at?: Date }
) => {
  if (!Array.isArray(dispute.timeline)) dispute.timeline = [];
  dispute.timeline.push({ ...event, at: event.at || new Date() } as IDisputeTimelineEvent);
};

/** Build a legacy-safe timeline when older disputes have no stored events. */
export const buildTimeline = (dispute: IDispute): IDisputeTimelineEvent[] => {
  const stored = Array.isArray(dispute.timeline) ? [...dispute.timeline] : [];
  if (!stored.some((event) => event.type === 'opened')) {
    stored.unshift({
      type: 'opened',
      actorType: dispute.raisedByType,
      actorName: dispute.raisedByType === 'customer' ? 'Customer' : 'Ustad',
      note: DISPUTE_REASON_LABELS[dispute.reason] || dispute.reason,
      at: dispute.createdAt,
    });
  }
  if (isDisputeClosed(dispute.status) && !stored.some((event) => ['resolved', 'dismissed', 'withdrawn'].includes(event.type))) {
    stored.push({
      type: dispute.status as IDisputeTimelineEvent['type'],
      actorType: dispute.status === 'withdrawn' ? dispute.raisedByType : 'admin',
      actorName: dispute.status === 'withdrawn' ? '' : 'ApnaUstad Team',
      note: dispute.resolutionDetails || '',
      at: dispute.closedAt || dispute.resolvedAt || dispute.updatedAt,
    });
  }
  return stored.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
};

export const countUnreadMessages = async (dispute: IDispute, role: DisputeViewerRole) => {
  const lastRead = dispute.lastReadAt?.[role] || null;
  const query: Record<string, any> = {
    dispute: dispute._id,
    senderType: { $ne: role },
  };
  if (lastRead) query.createdAt = { $gt: lastRead };
  return DisputeMessage.countDocuments(query);
};

/** Shape a dispute for the mobile Case Room / list (role-aware). */
export const serializeDisputeForViewer = async (dispute: IDispute, role: DisputeViewerRole) => {
  const plain: any = typeof (dispute as any).toObject === 'function' ? (dispute as any).toObject() : { ...dispute };
  const closed = isDisputeClosed(dispute.status);
  const outcome = deriveDisputeOutcome(dispute);
  const unreadCount = await countUnreadMessages(dispute, role);

  // Admin-only fields are never sent to mobile parties
  if (role !== 'admin') {
    delete plain.adminNotes;
    delete plain.lastReadAt;
  }

  return {
    ...plain,
    timeline: buildTimeline(dispute),
    phase: getDisputePhase(dispute.status),
    isClosed: closed,
    outcome,
    outcomeLabel: getOutcomeLabel(outcome),
    closedAt: dispute.closedAt || (closed ? dispute.resolvedAt || dispute.updatedAt : null),
    reasonLabel: DISPUTE_REASON_LABELS[dispute.reason] || dispute.reason,
    myRole: role,
    isRaisedByMe: role !== 'admin' && dispute.raisedByType === role,
    canChat: !closed,
    canWithdraw: !closed && role !== 'admin' && dispute.raisedByType === role,
    unreadCount,
  };
};

const safeEmit = (rooms: string[], event: string, payload: any) => {
  try {
    const io = getIO();
    rooms.forEach((room) => io.to(room).emit(event, payload));
  } catch (error) {
    logger.warn(`Socket emit skipped for ${event}: ${(error as Error).message}`);
  }
};

const disputeRooms = (dispute: IDispute) => [
  `user:${idOf(dispute.customer)}`,
  `worker:${idOf(dispute.worker)}`,
  'admin',
];

export const emitDisputeUpdated = (dispute: IDispute) => {
  safeEmit(disputeRooms(dispute), 'dispute:updated', {
    disputeId: idOf(dispute._id),
    bookingId: idOf(dispute.booking),
    status: dispute.status,
    phase: getDisputePhase(dispute.status),
    outcome: deriveDisputeOutcome(dispute),
  });
};

const previewOf = (message: Pick<IDisputeMessage, 'content' | 'attachments' | 'kind'>) => {
  const text = (message.content || '').trim();
  if (text) return text.slice(0, 120);
  if (message.attachments?.length) return `📷 ${message.attachments.length} photo${message.attachments.length > 1 ? 's' : ''}`;
  return '';
};

type PostMessageInput = {
  dispute: IDispute;
  senderType: DisputePartyType;
  senderId?: string | mongoose.Types.ObjectId | null;
  senderName?: string;
  content?: string;
  attachments?: string[];
  replyToId?: string | null;
  kind?: IDisputeMessage['kind'];
  /** Skip push notifications (e.g. for system events that already send their own) */
  silent?: boolean;
};

export const postDisputeMessage = async ({
  dispute,
  senderType,
  senderId = null,
  senderName,
  content = '',
  attachments = [],
  replyToId = null,
  kind = 'message',
  silent = false,
}: PostMessageInput) => {
  const normalizedContent = String(content || '').trim().slice(0, DISPUTE_MESSAGE_MAX_LENGTH);
  const normalizedAttachments = (attachments || [])
    .filter((url) => typeof url === 'string' && /^https:\/\//.test(url))
    .slice(0, DISPUTE_MESSAGE_MAX_ATTACHMENTS);

  let replySnapshot: IDisputeMessage['replySnapshot'] = null;
  let replyTo: mongoose.Types.ObjectId | null = null;
  if (replyToId && mongoose.Types.ObjectId.isValid(replyToId)) {
    const parent = await DisputeMessage.findOne({ _id: replyToId, dispute: dispute._id })
      .lean<IDisputeMessage>();
    if (parent) {
      replyTo = parent._id as mongoose.Types.ObjectId;
      replySnapshot = {
        content: previewOf(parent) || 'Message',
        senderType: parent.senderType,
        senderName: parent.senderName || '',
      };
    }
  }

  const resolvedName = senderName ?? (senderType === 'system' ? 'ApnaUstad' : await resolvePartyName(senderType, senderId));

  const message = await DisputeMessage.create({
    dispute: dispute._id,
    senderType,
    sender: senderId ? new mongoose.Types.ObjectId(String(senderId)) : null,
    senderName: resolvedName,
    content: normalizedContent,
    attachments: normalizedAttachments,
    kind,
    replyTo,
    replySnapshot,
  });

  const now = message.createdAt || new Date();
  const update: Record<string, any> = {
    $set: {
      lastMessageAt: now,
      lastMessagePreview: previewOf(message),
      lastMessageSenderType: senderType,
    },
    $inc: { messageCount: 1 },
  };
  // Sender has implicitly read everything up to their own message
  if (senderType === 'customer' || senderType === 'worker' || senderType === 'admin') {
    update.$set[`lastReadAt.${senderType}`] = now;
  }
  await Dispute.updateOne({ _id: dispute._id }, update);

  const payload = { ...message.toObject(), disputeId: idOf(dispute._id) };
  safeEmit(disputeRooms(dispute), 'dispute:message', payload);

  if (!silent && kind === 'message') {
    void notifyPartiesAboutMessage(dispute, senderType, resolvedName, previewOf(message));
  }

  return message;
};

const notifyPartiesAboutMessage = async (
  dispute: IDispute,
  senderType: DisputePartyType,
  senderName: string,
  preview: string
) => {
  try {
    const bookingId = idOf(dispute.booking);
    const disputeId = idOf(dispute._id);
    const caseRef = disputeId.slice(-6).toUpperCase();
    const bucket = Math.floor(Date.now() / NOTIFY_THROTTLE_MS);
    const label = senderType === 'admin' ? 'ApnaUstad Team' : senderName || (senderType === 'customer' ? 'Customer' : 'Ustad');

    const targets: Array<{ id: mongoose.Types.ObjectId; type: 'user' | 'worker'; role: DisputeViewerRole }> = [];
    if (senderType !== 'customer') targets.push({ id: dispute.customer, type: 'user', role: 'customer' });
    if (senderType !== 'worker') targets.push({ id: dispute.worker, type: 'worker', role: 'worker' });

    await Promise.allSettled(targets.map((target) =>
      sendNotificationToRecipient(
        target.id,
        target.type,
        `New message in complaint #${caseRef}`,
        `${label}: ${preview || 'sent an update'}`,
        { type: 'dispute', bookingId, disputeId },
        {
          type: 'dispute',
          icon: 'scale',
          color: senderType === 'admin' ? '#FFB800' : '#FF6B35',
          bookingId,
          idempotencyKey: `dispute-msg/${disputeId}/${target.role}/${bucket}`,
        },
      )
    ));
  } catch (error) {
    logger.error('Failed to notify dispute message recipients:', error);
  }
};

export const markDisputeRead = async (disputeId: string | mongoose.Types.ObjectId, role: DisputeViewerRole) => {
  await Dispute.updateOne({ _id: disputeId }, { $set: { [`lastReadAt.${role}`]: new Date() } });
};

export const fetchDisputeMessages = async (
  disputeId: string | mongoose.Types.ObjectId,
  { before, limit = 50 }: { before?: string | undefined; limit?: number | undefined } = {}
) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const query: Record<string, any> = { dispute: disputeId };
  if (before) {
    const beforeDate = new Date(before);
    if (!Number.isNaN(beforeDate.getTime())) query.createdAt = { $lt: beforeDate };
  }
  // Newest first (clients render inverted lists)
  const messages = await DisputeMessage.find(query).sort({ createdAt: -1 }).limit(safeLimit + 1).lean();
  const hasMore = messages.length > safeLimit;
  return { messages: messages.slice(0, safeLimit), hasMore };
};
