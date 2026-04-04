import Admin from "../models/Admin";
import User from "../models/User";
import Worker from "../models/Workers";
import Booking from "../models/Booking";
import Category from "../models/Category";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, UnauthorizedError } from "../utils/ApiError";
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

    // Revenue and Commission logic using Aggregation
    const revenueData = await Booking.aggregate([
        { $match: { status: 'completed' } },
        {
            $group: {
                _id: null,
                totalRevenue: { $sum: "$totalAmount" },
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
            newWorkersLastMonth
        }
    });
});

/**
 * Get current Admin profile
 * @route GET /api/v1/admin/me
 */
export const getAdminProfile = asyncHandler(async (req: AdminAuthRequest, res) => {
    return successResponse(res, 200, "Admin profile fetched successfully", req.admin);
});
