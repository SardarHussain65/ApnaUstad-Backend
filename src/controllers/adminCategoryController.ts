import Category from "../models/Category";
import Worker from "../models/Workers";
import Booking from "../models/Booking";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, NotFoundError, ConflictError } from "../utils/ApiError";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";

/**
 * Get all categories (Admin)
 * @route GET /api/v1/admin/categories
 */
export const getAllCategories = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    const total = await Category.countDocuments();
    const categories = await Category.find()
        .sort({ sortOrder: 1 })
        .skip(skip)
        .limit(limitNum);

    return paginatedResponse(res, 200, "Categories fetched successfully", categories, pageNum, limitNum, total);
});

/**
 * Create a new category
 * @route POST /api/v1/admin/categories
 */
export const createCategory = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { name, icon, color, description, sortOrder } = req.body;

    if (!name || !icon || !color) {
        throw new BadRequestError("Name, icon, and color are required fields");
    }

    const existingCategory = await Category.findOne({ name });
    if (existingCategory) {
        throw new ConflictError("Category with this name already exists");
    }

    try {
        const category = await Category.create({
            name,
            icon,
            color,
            description: description || "",
            sortOrder: sortOrder || 0
        });

        return successResponse(res, 201, "Category created successfully", category);
    } catch (error: any) {
        if (error.code === 11000) {
            throw new ConflictError("Category with this name already exists");
        }
        throw error;
    }
});

/**
 * Update a category
 * @route PATCH /api/v1/admin/categories/:id
 */
export const updateCategory = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { name, icon, color, description, sortOrder, isActive } = req.body;

    const category = await Category.findById(id);
    if (!category) {
        throw new NotFoundError("Category not found");
    }

    if (name) category.name = name;
    if (icon) category.icon = icon;
    if (color) category.color = color;
    if (description !== undefined) category.description = description;
    if (sortOrder !== undefined) category.sortOrder = sortOrder;
    if (isActive !== undefined) category.isActive = isActive;

    try {
        await category.save();
        return successResponse(res, 200, "Category updated successfully", category);
    } catch (error: any) {
        if (error.code === 11000) {
            throw new ConflictError("Category with this name already exists");
        }
        throw error;
    }
});

/**
 * Delete a category
 * @route DELETE /api/v1/admin/categories/:id
 */
export const deleteCategory = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) {
        throw new NotFoundError("Category not found");
    }

    // Check for dependent Worker and Booking records referencing this category
    const categoryName = category.name;
    const workerExists = await Worker.exists({ category: categoryName });
    const bookingExists = await Booking.exists({ category: categoryName });

    if (workerExists || bookingExists) {
        throw new BadRequestError("Cannot delete category as it is currently assigned to workers or bookings");
    }

    await category.deleteOne();

    return successResponse(res, 200, "Category deleted successfully", {});
});
