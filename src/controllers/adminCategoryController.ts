import Category from "../models/Category";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../utils/ApiError";
import { successResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";

/**
 * Get all categories (Admin)
 * @route GET /api/v1/admin/categories
 */
export const getAllCategories = asyncHandler(async (req: AdminAuthRequest, res) => {
    const categories = await Category.find().sort({ sortOrder: 1 });
    return successResponse(res, 200, "Categories fetched successfully", categories);
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
        throw new BadRequestError("Category with this name already exists");
    }

    const category = await Category.create({
        name,
        icon,
        color,
        description: description || "",
        sortOrder: sortOrder || 0
    });

    return successResponse(res, 201, "Category created successfully", category);
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

    await category.save();

    return successResponse(res, 200, "Category updated successfully", category);
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

    await category.deleteOne();

    return successResponse(res, 200, "Category deleted successfully", {});
});
