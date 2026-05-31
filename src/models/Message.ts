import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
    booking: mongoose.Types.ObjectId;
    sender: mongoose.Types.ObjectId;
    senderModel: 'User' | 'Worker';
    content: string;
    messageType: 'text' | 'audio';
    audioUrl?: string;
    audioDurationSeconds?: number;
    readAt?: Date;
    createdAt: Date;
}

const messageSchema = new Schema<IMessage>(
    {
        booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
        sender: { type: Schema.Types.ObjectId, required: true, refPath: 'senderModel' },
        senderModel: { type: String, required: true, enum: ['User', 'Worker'] },
        content: { type: String, required: true, trim: true, maxlength: 500 },
        messageType: { type: String, enum: ['text', 'audio'], default: 'text' },
        audioUrl: { type: String, trim: true },
        audioDurationSeconds: { type: Number, min: 0, max: 120 },
        readAt: { type: Date, default: null }
    },
    { timestamps: true }
);

// Indexes for fast lookup
messageSchema.index({ booking: 1, createdAt: 1 });

export default mongoose.models.Message || mongoose.model<IMessage>('Message', messageSchema);
