import mongoose, { Schema, Document } from 'mongoose';

export interface IJobPost extends Document {
    customer: mongoose.Types.ObjectId;
    category: string;
    description: string;
    urgency: 'instant' | 'scheduled';
    scheduledDate?: Date;
    scheduledTime?: string;
    address: string;
    location: {
        type: string;
        coordinates: number[];
    };
    status: 'open' | 'assigned' | 'closed' | 'cancelled' | 'reviewing';
    imageUrl?: string;
    radiusExpanded?: boolean;
    expiresAt: Date;
}

const jobPostSchema = new Schema<IJobPost>(
    {
        customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        category: { type: String, required: true },
        description: { type: String, required: true, trim: true, maxlength: 1000 },
        urgency: { type: String, enum: ['instant', 'scheduled'], default: 'scheduled' },
        scheduledDate: { type: Date },
        scheduledTime: { type: String },
        address: { type: String, trim: true, default: '' },
        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: { type: [Number], default: [0, 0] }
        },
        status: {
            type: String,
            enum: ['open', 'assigned', 'closed', 'cancelled', 'reviewing'],
            default: 'open'
        },
        imageUrl: { type: String, default: null },
        radiusExpanded: { type: Boolean, default: false },
        expiresAt: { type: Date, required: true }
    },
    { timestamps: true }
);

jobPostSchema.index({ location: '2dsphere' });
jobPostSchema.index({ customer: 1, status: 1 });
jobPostSchema.index({ category: 1, status: 1 });

export default mongoose.models.JobPost || mongoose.model<IJobPost>('JobPost', jobPostSchema);
