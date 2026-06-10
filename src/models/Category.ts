// src/models/Category.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface ICategory extends Document {
  name: string;
  icon: string;
  color: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  additionalCategoryMonthlyFee: number;
  additionalCategoryGraceDays: number;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    icon: { type: String, required: true },
    color: { type: String, required: true },
    description: { type: String, default: '' },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    additionalCategoryMonthlyFee: { type: Number, min: 0, default: 0 },
    additionalCategoryGraceDays: { type: Number, min: 0, max: 30, default: 3 }
  },
  { timestamps: true }
);

export default mongoose.models.Category || mongoose.model<ICategory>('Category', categorySchema);
