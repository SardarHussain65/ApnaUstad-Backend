import Payment from "../models/Payment";
import Booking from "../models/Booking";
import Worker from "../models/Workers";
import User from "../models/User";
import { asyncHandler } from "../utils/asyncHandler";
import { successResponse } from "../utils/ApiResponse";

/**
 * Get Platform Revenue & Earnings Report
 * @route GET /api/v1/admin/reports/revenue
 */
export const getRevenueReport = asyncHandler(async (req, res) => {
    // Total paid payments summary
    const summary = await Payment.aggregate([
        { $match: { status: 'paid' } },
        {
            $group: {
                _id: null,
                totalRevenue: { $sum: "$amount" },
                totalCommission: { $sum: "$platformFee" },
                totalWorkerEarnings: { $sum: "$workerEarning" },
                count: { $sum: 1 }
            }
        }
    ]);

    // Monthly trend for the past 12 months
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    
    const monthlyTrend = await Payment.aggregate([
        { $match: { status: 'paid', paidAt: { $gte: twelveMonthsAgo } } },
        {
            $group: {
                _id: {
                    year: { $year: "$paidAt" },
                    month: { $month: "$paidAt" }
                },
                revenue: { $sum: "$amount" },
                commission: { $sum: "$platformFee" },
                count: { $sum: 1 }
            }
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    return successResponse(res, 200, "Revenue report fetched successfully", {
        summary: summary[0] || { totalRevenue: 0, totalCommission: 0, totalWorkerEarnings: 0, count: 0 },
        monthlyTrend: monthlyTrend.map(t => ({
            month: `${t._id.year}-${String(t._id.month).padStart(2, '0')}`,
            revenue: t.revenue,
            commission: t.commission,
            count: t.count
        }))
    });
});

/**
 * Get Booking Statistics Breakdown
 * @route GET /api/v1/admin/reports/bookings
 */
export const getBookingsReport = asyncHandler(async (req, res) => {
    // Bookings by category
    const categoryBreakdown = await Booking.aggregate([
        {
            $group: {
                _id: "$category",
                count: { $sum: 1 },
                totalValue: { $sum: "$totalAmount" }
            }
        },
        { $sort: { count: -1 } }
    ]);

    // Bookings by status
    const statusBreakdown = await Booking.aggregate([
        {
            $group: {
                _id: "$status",
                count: { $sum: 1 }
            }
        }
    ]);

    // Bookings by city
    const cityBreakdown = await Booking.aggregate([
        {
            $group: {
                _id: "$city",
                count: { $sum: 1 },
                totalValue: { $sum: "$totalAmount" }
            }
        },
        { $sort: { count: -1 } }
    ]);

    return successResponse(res, 200, "Bookings report fetched successfully", {
        categoryBreakdown: categoryBreakdown.map(c => ({
            category: c._id || "General",
            count: c.count,
            totalValue: c.totalValue
        })),
        statusBreakdown: statusBreakdown.map(s => ({
            status: s._id,
            count: s.count
        })),
        cityBreakdown: cityBreakdown.map(c => ({
            city: c._id || "Unknown",
            count: c.count,
            totalValue: c.totalValue
        }))
    });
});

/**
 * Get Worker Performance Leaderboard
 * @route GET /api/v1/admin/reports/workers
 */
export const getWorkersReport = asyncHandler(async (req, res) => {
    const topEarners = await Worker.find()
        .sort({ totalEarnings: -1 })
        .limit(10)
        .select("fullName phone category totalEarnings totalJobs rating");

    const topRated = await Worker.find()
        .sort({ rating: -1, totalReviews: -1 })
        .limit(10)
        .select("fullName phone category totalEarnings totalJobs rating");

    return successResponse(res, 200, "Workers performance report fetched successfully", {
        topEarners,
        topRated
    });
});

/**
 * Get User & Worker Growth Over Time
 * @route GET /api/v1/admin/reports/users
 */
export const getUsersReport = asyncHandler(async (req, res) => {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const userGrowth = await User.aggregate([
        { $match: { createdAt: { $gte: twelveMonthsAgo } } },
        {
            $group: {
                _id: {
                    year: { $year: "$createdAt" },
                    month: { $month: "$createdAt" }
                },
                count: { $sum: 1 }
            }
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    const workerGrowth = await Worker.aggregate([
        { $match: { createdAt: { $gte: twelveMonthsAgo } } },
        {
            $group: {
                _id: {
                    year: { $year: "$createdAt" },
                    month: { $month: "$createdAt" }
                },
                count: { $sum: 1 }
            }
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    return successResponse(res, 200, "Users growth report fetched successfully", {
        users: userGrowth.map(u => ({
            month: `${u._id.year}-${String(u._id.month).padStart(2, '0')}`,
            count: u.count
        })),
        workers: workerGrowth.map(w => ({
            month: `${w._id.year}-${String(w._id.month).padStart(2, '0')}`,
            count: w.count
        }))
    });
});
