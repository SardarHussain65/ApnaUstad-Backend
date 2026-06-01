import mongoose, { Document, Schema } from 'mongoose';

export interface ISupportRequest extends Document {
  user?: mongoose.Types.ObjectId;
  name: string;
  email?: string;
  topic?: string;
  message: string;
  status: 'open' | 'closed' | 'pending';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  metadata?: Record<string, any>;
  replies?: {
    from: 'admin' | 'user';
    message: string;
    authorName?: string;
    createdAt: Date;
  }[];
  createdAt: Date;
}

const SupportRequestSchema = new Schema<ISupportRequest>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: false },
  name: { type: String, required: true },
  email: { type: String, required: false },
  topic: { type: String, required: false },
  message: { type: String, required: true },
  status: { type: String, enum: ['open', 'closed', 'pending'], default: 'open' },
  priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
  metadata: { type: Schema.Types.Mixed, required: false },
  replies: [
    {
      from: { type: String, enum: ['admin', 'user'], required: true },
      message: { type: String, required: true },
      authorName: { type: String, required: false },
      createdAt: { type: Date, default: () => new Date() },
    }
  ],
  createdAt: { type: Date, default: () => new Date() },
});

export const SupportRequest = mongoose.model<ISupportRequest>('SupportRequest', SupportRequestSchema);

export default SupportRequest;
