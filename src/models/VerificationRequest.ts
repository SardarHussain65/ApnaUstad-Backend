import mongoose, { Document, Schema } from 'mongoose';

export interface IVerificationRequest extends Document {
  worker: mongoose.Types.ObjectId;
  cnicNumber: string;
  cnicFrontImage: string;
  cnicBackImage: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  adminNotes?: string;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const VerificationRequestSchema = new Schema<IVerificationRequest>(
  {
    worker: { type: Schema.Types.ObjectId, ref: 'Worker', required: true },
    cnicNumber: { type: String, required: true, trim: true },
    cnicFrontImage: { type: String, required: true },
    cnicBackImage: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', required: true },
    rejectionReason: { type: String, default: '' },
    adminNotes: { type: String, default: '' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

// Indexes for rapid queries and filters
VerificationRequestSchema.index({ worker: 1 });
VerificationRequestSchema.index({ status: 1 });
VerificationRequestSchema.index({ cnicNumber: 1 });

export const VerificationRequest = mongoose.models.VerificationRequest || mongoose.model<IVerificationRequest>('VerificationRequest', VerificationRequestSchema);

export default VerificationRequest;
