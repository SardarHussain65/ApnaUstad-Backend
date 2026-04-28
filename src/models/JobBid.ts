import mongoose, { Schema, Document } from 'mongoose';

export interface IJobBid extends Document {
    jobPost: mongoose.Types.ObjectId;
    worker: mongoose.Types.ObjectId;
    message: string;
    proposedPrice: number;
    status: 'pending' | 'accepted' | 'rejected';
}

const jobBidSchema = new Schema<IJobBid>(
    {
        jobPost: { type: Schema.Types.ObjectId, ref: 'JobPost', required: true },
        worker: { type: Schema.Types.ObjectId, ref: 'Worker', required: true },
        message: { type: String, required: true, trim: true, maxlength: 500 },
        proposedPrice: { type: Number, required: true, min: 0 },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'rejected'],
            default: 'pending'
        }
    },
    { timestamps: true }
);

// A worker can only have one active bid per job post
jobBidSchema.index({ jobPost: 1, worker: 1 }, { unique: true });
jobBidSchema.index({ jobPost: 1, status: 1 });

export default mongoose.models.JobBid || mongoose.model<IJobBid>('JobBid', jobBidSchema);
