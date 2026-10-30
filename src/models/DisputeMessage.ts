// src/models/DisputeMessage.ts
// Messages inside a dispute "Case Room" — a 3-way thread between Customer, Ustad and ApnaUstad Team.
import mongoose, { Schema, Document } from 'mongoose';
import type { DisputePartyType } from './Dispute';

export interface IDisputeReplySnapshot {
  content: string;
  senderType: DisputePartyType;
  senderName?: string;
}

export interface IDisputeMessage extends Document {
  dispute: mongoose.Types.ObjectId;
  senderType: DisputePartyType;
  sender?: mongoose.Types.ObjectId | null;
  senderName?: string;
  content: string;
  attachments: string[];
  kind: 'message' | 'system' | 'decision';
  replyTo?: mongoose.Types.ObjectId | null;
  replySnapshot?: IDisputeReplySnapshot | null;
  createdAt: Date;
  updatedAt: Date;
}

const disputeMessageSchema = new Schema<IDisputeMessage>(
  {
    dispute: { type: Schema.Types.ObjectId, ref: 'Dispute', required: true },
    senderType: { type: String, enum: ['customer', 'worker', 'admin', 'system'], required: true },
    sender: { type: Schema.Types.ObjectId, default: null },
    senderName: { type: String, trim: true, default: '' },
    content: { type: String, trim: true, maxlength: 1000, default: '' },
    attachments: { type: [String], default: [] },
    kind: { type: String, enum: ['message', 'system', 'decision'], default: 'message' },
    replyTo: { type: Schema.Types.ObjectId, ref: 'DisputeMessage', default: null },
    replySnapshot: {
      type: new Schema<IDisputeReplySnapshot>(
        {
          content: { type: String, trim: true, maxlength: 200 },
          senderType: { type: String, enum: ['customer', 'worker', 'admin', 'system'] },
          senderName: { type: String, trim: true },
        },
        { _id: false }
      ),
      default: null,
    },
  },
  { timestamps: true }
);

disputeMessageSchema.index({ dispute: 1, createdAt: -1 });

export default mongoose.models.DisputeMessage ||
  mongoose.model<IDisputeMessage>('DisputeMessage', disputeMessageSchema);

