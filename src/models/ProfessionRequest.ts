import mongoose, { Document, Schema } from 'mongoose';

export interface IProfessionRequest extends Document {
  worker?: mongoose.Types.ObjectId;
  professionName: string;
  categoryDomain?: string;
  requirements?: string;
  description?: string;
  experience?: number;
  hourlyRate?: number;
  skills?: string[];
  requesterName: string;
  requesterPhone: string;
  requesterEmail?: string;
  sampleImages?: string[];
  certificates?: {
    title: string;
    issuingOrg?: string;
    issueYear?: string;
    certificateUrl: string;
  }[];
  status: 'pending' | 'approved' | 'rejected';
  adminNotes?: string;
  rejectionReason?: string;
  createdCategoryId?: mongoose.Types.ObjectId;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ProfessionRequestSchema = new Schema<IProfessionRequest>(
  {
    worker: { type: Schema.Types.ObjectId, ref: 'Workers' },
    professionName: { type: String, required: true, trim: true },
    categoryDomain: { type: String, trim: true, default: '' },
    requirements: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    experience: { type: Number, default: 0, min: 0 },
    hourlyRate: { type: Number, default: 0, min: 0 },
    skills: { type: [String], default: [] },
    requesterName: { type: String, required: true, trim: true },
    requesterPhone: { type: String, required: true, trim: true },
    requesterEmail: { type: String, trim: true, default: '' },
    sampleImages: { type: [String], default: [] },
    certificates: {
      type: [
        {
          title: { type: String, required: true, trim: true },
          issuingOrg: { type: String, trim: true, default: '' },
          issueYear: { type: String, trim: true, default: '' },
          certificateUrl: { type: String, required: true },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      required: true,
    },
    adminNotes: { type: String, default: '' },
    rejectionReason: { type: String, default: '' },
    createdCategoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

ProfessionRequestSchema.index({ status: 1 });
ProfessionRequestSchema.index({ requesterPhone: 1 });
ProfessionRequestSchema.index({ professionName: 1 });
ProfessionRequestSchema.index({ worker: 1 });

export const ProfessionRequest =
  mongoose.models.ProfessionRequest ||
  mongoose.model<IProfessionRequest>('ProfessionRequest', ProfessionRequestSchema);

export default ProfessionRequest;
