// src/models/Reviews.ts
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IReview extends Document {
    booking: mongoose.Types.ObjectId;
    customer: mongoose.Types.ObjectId;
    worker: mongoose.Types.ObjectId;
    rating: number;
    comment: string;
    isFlagged: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const reviewSchema = new Schema<IReview>(
    {
        booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
        customer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        worker: { type: Schema.Types.ObjectId, ref: 'Worker', required: true },
        rating: { type: Number, required: true, min: 1, max: 5 },
        comment: { type: String, trim: true, maxlength: 500, default: '' },
        isFlagged: { type: Boolean, default: false }
    },
    { timestamps: true }
);

// Auto-calculate worker rating after a review is saved
reviewSchema.post('save', async function (doc) {
    const Review = doc.constructor as any;
    const stats = await Review.aggregate([
        { $match: { worker: doc.worker } },
        { $group: { _id: '$worker', avgRating: { $avg: '$rating' }, totalReviews: { $sum: 1 } } }
    ]);

    if (stats.length > 0) {
        await mongoose.model('Worker').findByIdAndUpdate(doc.worker, {
            rating: Math.round(stats[0].avgRating * 10) / 10,
            totalReviews: stats[0].totalReviews
        });
    }
});
reviewSchema.index({ worker: 1, createdAt: -1 });
reviewSchema.index({ customer: 1, createdAt: -1 });


export default mongoose.models.Review || mongoose.model<IReview>('Review', reviewSchema);
