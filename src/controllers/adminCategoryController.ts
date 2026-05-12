import Category from "../models/Category";
import Worker from "../models/Workers";
import Booking from "../models/Booking";
import JobPost from "../models/JobPost";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, NotFoundError, ConflictError } from "../utils/ApiError";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Get all categories (Admin)
 * @route GET /api/v1/admin/categories
 */
export const getAllCategories = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { page = '1', limit = '100', search, active } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 100));
    const skip = (pageNum - 1) * limitNum;

    const query: Record<string, any> = {};

    if (search && typeof search === 'string') {
        const searchRegex = new RegExp(escapeRegex(search), 'i');
        query.$or = [{ name: searchRegex }, { description: searchRegex }];
    }

    if (active === 'true' || active === 'false') {
        query.isActive = active === 'true';
    }

    const total = await Category.countDocuments(query);
    const categories = await Category.find(query)
        .sort({ sortOrder: 1, name: 1 })
        .skip(skip)
        .limit(limitNum);

    return paginatedResponse(res, 200, "Categories fetched successfully", categories, pageNum, limitNum, total);
});

/**
 * Create a new category
 * @route POST /api/v1/admin/categories
 */
export const createCategory = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { name, icon, color, description, sortOrder, isActive } = req.body;

    const existingCategory = await Category.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
    if (existingCategory) {
        throw new ConflictError("Category with this name already exists");
    }

    try {
        const category = await Category.create({
            name,
            icon,
            color,
            description: description || "",
            sortOrder: sortOrder || 0,
            isActive: isActive !== undefined ? isActive : true
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

    if (name !== undefined && name !== category.name) {
        const existingCategory = await Category.findOne({
            _id: { $ne: id },
            name: new RegExp(`^${escapeRegex(name)}$`, 'i')
        });
        if (existingCategory) {
            throw new ConflictError("Category with this name already exists");
        }
        category.name = name;
    }
    if (icon !== undefined) category.icon = icon;
    if (color !== undefined) category.color = color;
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

    // Check for dependent Worker, Booking, and Job records referencing this category
    const categoryName = category.name;
    const [workerExists, bookingExists, jobExists] = await Promise.all([
        Worker.exists({ category: categoryName }),
        Booking.exists({ category: categoryName }),
        JobPost.exists({ category: categoryName })
    ]);

    if (workerExists || bookingExists || jobExists) {
        throw new BadRequestError("Cannot delete category as it is currently assigned to workers, bookings, or jobs");
    }

    await category.deleteOne();

    return successResponse(res, 200, "Category deleted successfully", {});
});
