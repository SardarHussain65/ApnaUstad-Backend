// src/models/Dispute.ts
import mongoose, { Schema, Document } from 'mongoose';

export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'dismissed' | 'withdrawn';
export type DisputeOutcome = 'customer_favor' | 'worker_favor' | 'settled';
export type DisputePartyType = 'customer' | 'worker' | 'admin' | 'system';

export type DisputeTimelineType =
  | 'opened'
  | 'evidence_added'
  | 'under_review'
  | 'withdrawn'
  | 'resolved'
  | 'dismissed'
  | 'closed';

export interface IDisputeTimelineEvent {
  type: DisputeTimelineType;
  actorType: DisputePartyType;
  actorName?: string;
  note?: string;
  at: Date;
}

export interface IDispute extends Document {
  booking: mongoose.Types.ObjectId;
  customer: mongoose.Types.ObjectId;
  worker: mongoose.Types.ObjectId;
  raisedBy: mongoose.Types.ObjectId;
  raisedByType: 'customer' | 'worker';
  reason: 'incomplete_work' | 'unfair_pricing' | 'no_show' | 'poor_quality' | 'payment_issue' | 'other';
  description: string;
  status: DisputeStatus;
  /** Final outcome once the case is closed */
  outcome?: DisputeOutcome | null;
  amountDisputed: number;
  proofImages: string[];
  adminNotes?: string;
  resolutionDetails?: string;
  resolvedBy?: mongoose.Types.ObjectId;
  resolvedAt?: Date;
  closedAt?: Date | null;
  closedByType?: DisputePartyType | null;
  timeline: IDisputeTimelineEvent[];
  lastMessageAt?: Date | null;
  lastMessagePreview?: string;
  lastMessageSenderType?: DisputePartyType | null;
  messageCount: number;
  lastReadAt: {
    customer?: Date | null;
    worker?: Date | null;
    admin?: Date | null;
  };
  moderationApplied?: {
    warnedCustomer?: boolean;
    warnedWorker?: boolean;
    workerPenalty?: number;
    workerCommissionRefund?: number;
    customerRefund?: number;
    customerBlocked?: boolean;
    workerBlocked?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const timelineEventSchema = new Schema<IDisputeTimelineEvent>(
  {
    type: {
      type: String,
      enum: ['opened', 'evidence_added', 'under_review', 'withdrawn', 'resolved', 'dismissed', 'closed'],
      required: true,
    },
    actorType: { type: String, enum: ['customer', 'worker', 'admin', 'system'], required: true },
    actorName: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const disputeSchema = new Schema<IDispute>(
  {
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    worker: { type: Schema.Types.ObjectId, ref: 'Worker', required: true, index: true },
    raisedBy: { type: Schema.Types.ObjectId, required: true },
    raisedByType: { type: String, enum: ['customer', 'worker'], required: true },
    reason: {
      type: String,
      enum: ['incomplete_work', 'unfair_pricing', 'no_show', 'poor_quality', 'payment_issue', 'other'],
      required: true,
      index: true
    },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ['open', 'under_review', 'resolved', 'dismissed', 'withdrawn'],
      default: 'open',
      index: true
    },
    outcome: {
      type: String,
      enum: ['customer_favor', 'worker_favor', 'settled', null],
      default: null,
    },
    amountDisputed: { type: Number, default: 0, min: 0 },
    proofImages: { type: [String], default: [] },
    adminNotes: { type: String, trim: true, default: '' },
    resolutionDetails: { type: String, trim: true, default: '' },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closedByType: { type: String, enum: ['customer', 'worker', 'admin', 'system', null], default: null },
    timeline: { type: [timelineEventSchema], default: [] },
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, trim: true, default: '' },
    lastMessageSenderType: { type: String, enum: ['customer', 'worker', 'admin', 'system', null], default: null },
    messageCount: { type: Number, default: 0, min: 0 },
    lastReadAt: {
      customer: { type: Date, default: null },
      worker: { type: Date, default: null },
      admin: { type: Date, default: null },
    },
    moderationApplied: {
      warnedCustomer: { type: Boolean, default: false },
      warnedWorker: { type: Boolean, default: false },
      workerPenalty: { type: Number, default: 0, min: 0 },
      workerCommissionRefund: { type: Number, default: 0, min: 0 },
      customerRefund: { type: Number, default: 0, min: 0 },
      customerBlocked: { type: Boolean, default: false },
      workerBlocked: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

disputeSchema.index({ booking: 1 }, { unique: true }); // A booking can only have one dispute
disputeSchema.index({ createdAt: -1 });
disputeSchema.index({ status: 1, lastMessageAt: -1 });

export default mongoose.models.Dispute || mongoose.model<IDispute>('Dispute', disputeSchema);
