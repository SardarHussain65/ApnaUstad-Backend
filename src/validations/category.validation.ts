import { z } from "zod";

const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

export const createCategorySchema = z.object({
    name: z.string({ error: "Category name is required" }).trim().min(2, "Category name must be at least 2 characters long").max(60, "Category name cannot exceed 60 characters"),
    icon: z.string({ error: "Category icon is required" }).trim().min(2, "Category icon is required").max(60, "Category icon cannot exceed 60 characters"),
    color: z.string({ error: "Category color is required" }).trim().regex(hexColorRegex, "Color must be a valid hex value"),
    description: z.string().trim().max(300, "Description cannot exceed 300 characters").optional().default(""),
    sortOrder: z.coerce.number().int().min(0, "Sort order cannot be negative").optional().default(0),
    isActive: z.boolean().optional().default(true),
    additionalCategoryMonthlyFee: z.coerce.number().min(0, "Monthly fee cannot be negative").optional().default(0),
    additionalCategoryGraceDays: z.coerce.number().int().min(0).max(30).optional().default(3),
});

export const updateCategorySchema = createCategorySchema.partial().refine(
    data => Object.keys(data).length > 0,
    { message: "At least one field is required to update" }
);
