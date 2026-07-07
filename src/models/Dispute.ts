// src/models/Dispute.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IDispute extends Document {
  booking: mongoose.Types.ObjectId;
  customer: mongoose.Types.ObjectId;
  worker: mongoose.Types.ObjectId;
  raisedBy: mongoose.Types.ObjectId;
  raisedByType: 'customer' | 'worker';
  reason: 'incomplete_work' | 'unfair_pricing' | 'no_show' | 'poor_quality' | 'payment_issue' | 'other';
  description: string;
  status: 'open' | 'under_review' | 'resolved' | 'dismissed';
  amountDisputed: number;
  proofImages: string[];
  adminNotes?: string;
  resolutionDetails?: string;
  resolvedBy?: mongoose.Types.ObjectId;
  resolvedAt?: Date;
  moderationApplied?: {
    warnedCustomer?: boolean;
    warnedWorker?: boolean;
    workerPenalty?: number;
    customerRefund?: number;
    customerBlocked?: boolean;
    workerBlocked?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

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
      enum: ['open', 'under_review', 'resolved', 'dismissed'],
      default: 'open',
      index: true
    },
    amountDisputed: { type: Number, default: 0, min: 0 },
    proofImages: { type: [String], default: [] },
    adminNotes: { type: String, trim: true, default: '' },
    resolutionDetails: { type: String, trim: true, default: '' },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
    resolvedAt: { type: Date, default: null },
    moderationApplied: {
      warnedCustomer: { type: Boolean, default: false },
      warnedWorker: { type: Boolean, default: false },
      workerPenalty: { type: Number, default: 0, min: 0 },
      customerRefund: { type: Number, default: 0, min: 0 },
      customerBlocked: { type: Boolean, default: false },
      workerBlocked: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

disputeSchema.index({ booking: 1 }, { unique: true }); // A booking can only have one dispute
disputeSchema.index({ createdAt: -1 });

export default mongoose.models.Dispute || mongoose.model<IDispute>('Dispute', disputeSchema);
