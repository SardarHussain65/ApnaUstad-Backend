import { Response } from "express";
import Admin from "../models/Admin";
import User from "../models/User";
import Worker from "../models/Workers";
import Booking from "../models/Booking";
import Category from "../models/Category";
import Payment from "../models/Payment";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, UnauthorizedError, NotFoundError, ForbiddenError, ConflictError } from "../utils/ApiError";
import { successResponse } from "../utils/ApiResponse";
import { generateToken } from "../middlewares/jwt.middleware";
import { AdminAuthRequest } from "../middlewares/admin.middleware";

/**
 * Admin Login
 * @route POST /api/v1/admin/login
 */
export const loginAdmin = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new BadRequestError("Email and password are required");
    }

    const admin = await Admin.findOne({ email }).select("+password");

    if (!admin) {
        throw new UnauthorizedError("Invalid email or password");
    }

    const isPasswordCorrect = await admin.isPasswordCorrect(password);
    if (!isPasswordCorrect) {
        throw new UnauthorizedError("Invalid email or password");
    }

    if (admin.status === 'inactive') {
        throw new UnauthorizedError("Your account has been deactivated");
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Generate token - using the existing generic generateToken
    // Note: We cast to any because the existing TokenPayload interface is strict
    const token = generateToken({
        id: admin._id.toString(),
        role: admin.role,
        type: 'admin'
    });

    // Remove password from response
    const adminData = admin.toObject();
    delete adminData.password;

    return successResponse(res, 200, "Admin logged in successfully", {
        admin: adminData,
        token
    });
});

/**
 * Get Dashboard Statistics
 * @route GET /api/v1/admin/dashboard/stats
 */
export const getDashboardStats = asyncHandler(async (req: AdminAuthRequest, res) => {
    const totalUsers = await User.countDocuments();
    const totalWorkers = await Worker.countDocuments();
    const totalBookings = await Booking.countDocuments();

    // Revenue and Commission are based on confirmed cash ledger rows.
    const revenueData = await Payment.aggregate([
        { $match: { status: 'paid' } },
        {
            $group: {
                _id: null,
                totalRevenue: { $sum: "$amount" },
                totalCommission: { $sum: "$platformFee" }
            }
        }
    ]);

    const totalRevenue = revenueData.length > 0 ? revenueData[0].totalRevenue : 0;
    const totalCommission = revenueData.length > 0 ? revenueData[0].totalCommission : 0;

    // Monthly stats (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const newUsersLastMonth = await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });
    const newWorkersLastMonth = await Worker.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });
    const newBookingsLastMonth = await Booking.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });

    const newRevenueData = await Payment.aggregate([
        { $match: { status: 'paid', createdAt: { $gte: thirtyDaysAgo } } },
        {
            $group: {
                _id: null,
                totalRevenue: { $sum: "$amount" },
                totalCommission: { $sum: "$platformFee" }
            }
        }
    ]);
    const newRevenueLastMonth = newRevenueData.length > 0 ? newRevenueData[0].totalRevenue : 0;
    const newCommissionLastMonth = newRevenueData.length > 0 ? newRevenueData[0].totalCommission : 0;

    return successResponse(res, 200, "Dashboard stats fetched successfully", {
        counts: {
            users: totalUsers,
            workers: totalWorkers,
            bookings: totalBookings,
            revenue: totalRevenue,
            commission: totalCommission
        },
        growth: {
            newUsersLastMonth,
            newWorkersLastMonth,
            newBookingsLastMonth,
            newRevenueLastMonth,
            newCommissionLastMonth
        }
    });
});

/**
 * Get current Admin profile
 * @route GET /api/v1/admin/me
 */
export const getAdminProfile = asyncHandler(async (req: AdminAuthRequest, res: Response) => {
    return successResponse(res, 200, "Admin profile fetched successfully", req.admin);
});

/**
 * Update current Admin profile
 * @route PATCH /api/v1/admin/me
 */
export const updateAdminProfile = asyncHandler(async (req: AdminAuthRequest, res: Response) => {
    const { fullName, email } = req.body;
    const admin = await Admin.findById(req.admin?._id);

    if (!admin) {
        return successResponse(res, 404, "Admin not found");
    }

    if (fullName) admin.fullName = fullName;
    if (email) {
        // Check if email already exists
        const exists = await Admin.findOne({ email, _id: { $ne: admin._id } });
        if (exists) {
            return successResponse(res, 400, "Email is already in use by another admin");
        }
        admin.email = email;
    }

    await admin.save();

    const adminData = admin.toObject();
    delete adminData.password;

    return successResponse(res, 200, "Admin profile updated successfully", adminData);
});

/**
 * Change current Admin password
 * @route POST /api/v1/admin/change-password
 */
export const changeAdminPassword = asyncHandler(async (req: AdminAuthRequest, res: Response) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return successResponse(res, 400, "Current password and new password are required");
    }

    const admin = await Admin.findById(req.admin?._id).select("+password");
    if (!admin) {
        return successResponse(res, 404, "Admin not found");
    }

    const isMatch = await admin.isPasswordCorrect(currentPassword);
    if (!isMatch) {
        return successResponse(res, 400, "Incorrect current password");
    }

    admin.password = newPassword;
    await admin.save();

    return successResponse(res, 200, "Password changed successfully", null);
});

/**
 * Get all admin users
 * @route GET /api/v1/admin/admins
 */
export const getAllAdmins = asyncHandler(async (req: AdminAuthRequest, res: Response) => {
    const admins = await Admin.find().select("-password");
    return successResponse(res, 200, "Admin accounts fetched successfully", admins);
});

/**
 * Create a new sub-admin
 * @route POST /api/v1/admin/admins
 */
export const createAdmin = asyncHandler(async (req: AdminAuthRequest, res: Response) => {
    const { fullName, email, password, role } = req.body;

    if (!fullName || !email || !password || !role) {
        throw new BadRequestError("All fields (fullName, email, password, role) are required");
    }

    if (role !== 'admin' && role !== 'superadmin') {
        throw new BadRequestError("Invalid role specified");
    }

    // Check if email already in use
    const exists = await Admin.findOne({ email });
    if (exists) {
        throw new ConflictError("An admin account with this email already exists");
    }

    const newAdmin = await Admin.create({
        fullName,
        email,
        password,
        role,
        status: 'active'
    });

    const adminData = newAdmin.toObject();
    delete adminData.password;

    return successResponse(res, 201, "Admin account created successfully", adminData);
});

/**
 * Toggle admin account status (activate/deactivate)
 * @route PATCH /api/v1/admin/admins/:id/status
 */
export const toggleAdminStatus = asyncHandler(async (req: AdminAuthRequest, res: Response) => {
    const { id } = req.params;

    // Safety: check self-deactivation
    if (id === req.admin?._id.toString()) {
        throw new BadRequestError("You cannot deactivate your own account");
    }

    const admin = await Admin.findById(id);
    if (!admin) {
        throw new NotFoundError("Admin account not found");
    }

    admin.status = admin.status === 'active' ? 'inactive' : 'active';
    await admin.save();

    const adminData = admin.toObject();
    delete adminData.password;

    return successResponse(
        res,
        200,
        `Admin account ${admin.status === 'active' ? 'activated' : 'deactivated'} successfully`,
        adminData
    );
});

/**
 * Delete admin account
 * @route DELETE /api/v1/admin/admins/:id
 */
export const deleteAdmin = asyncHandler(async (req: AdminAuthRequest, res: Response) => {
    const { id } = req.params;

    // Safety: check self-deletion
    if (id === req.admin?._id.toString()) {
        throw new BadRequestError("You cannot delete your own account");
    }

    const admin = await Admin.findById(id);
    if (!admin) {
        throw new NotFoundError("Admin account not found");
    }

    await Admin.findByIdAndDelete(id);

    return successResponse(res, 200, "Admin account deleted successfully", null);
});
