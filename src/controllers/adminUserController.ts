import mongoose from "mongoose";
import User from "../models/User";
import Booking from "../models/Booking";
import JobPost from "../models/JobPost";
import Dispute from "../models/Dispute";
import Review from "../models/Reviews";
import { asyncHandler } from "../utils/asyncHandler";
import { BadRequestError, NotFoundError } from "../utils/ApiError";
import { successResponse, paginatedResponse } from "../utils/ApiResponse";
import { AdminAuthRequest } from "../middlewares/admin.middleware";
import { recordAdminAction } from "../services/adminAuditLog";

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Get all users for admin management
 * @route GET /api/v1/admin/users
 */
export const getAllUsers = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { status, search, city, dateFrom, page = '1', limit = '10' } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = Math.min(parseInt(limit as string, 10) || 10, 200);
    const skip = (pageNum - 1) * limitNum;

    let query: any = {};
    if (status !== undefined) {
        query.isActive = status === 'active';
    }
    
    if (search) {
        const searchRegex = new RegExp(escapeRegex(search as string), 'i');
        query.$or = [
            { fullName: searchRegex },
            { email: searchRegex },
            { phone: searchRegex }
        ];
    }
    
    if (city) {
        query.city = new RegExp(escapeRegex(city as string), 'i');
    }

    if (dateFrom) {
        const joinedAfter = new Date(dateFrom as string);
        if (Number.isNaN(joinedAfter.getTime())) {
            throw new BadRequestError("Invalid dateFrom");
        }
        query.createdAt = { $gte: joinedAfter };
    }

    // Admins get to see everything for analysis
    const total = await User.countDocuments(query);
    const rawUsers = await User.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum);

    let users: any[] = rawUsers;
    try {
        const userIds = rawUsers
            .map((u: any) => u?._id)
            .filter((id: any) => id && mongoose.Types.ObjectId.isValid(String(id)))
            .map((id: any) => new mongoose.Types.ObjectId(String(id)));

        if (userIds.length > 0 && typeof Booking?.aggregate === "function") {
            const [bookingStats, jobStats] = await Promise.all([
                Booking.aggregate([
                    { $match: { customer: { $in: userIds } } },
                    {
                        $group: {
                            _id: "$customer",
                            totalBookings: { $sum: 1 },
                            completedBookings: {
                                $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
                            },
                            activeBookings: {
                                $sum: {
                                    $cond: [
                                        { $in: ["$status", ["pending", "accepted", "ongoing"]] },
                                        1,
                                        0,
                                    ],
                                },
                            },
                            totalSpent: {
                                $sum: {
                                    $cond: [
                                        { $eq: ["$status", "completed"] },
                                        { $ifNull: ["$totalAmount", 0] },
                                        0,
                                    ],
                                },
                            },
                            lastBookingAt: { $max: "$createdAt" },
                        },
                    },
                ]),
                typeof JobPost?.aggregate === "function"
                    ? JobPost.aggregate([
                          { $match: { customer: { $in: userIds } } },
                          { $group: { _id: "$customer", totalJobs: { $sum: 1 } } },
                      ])
                    : Promise.resolve([]),
            ]);

            const bookingMap = new Map<string, any>();
            for (const b of bookingStats || []) {
                bookingMap.set(String(b._id), b);
            }
            const jobMap = new Map<string, number>();
            for (const j of jobStats || []) {
                jobMap.set(String(j._id), j.totalJobs || 0);
            }

            users = rawUsers.map((u: any) => {
                const obj = typeof u.toObject === "function" ? u.toObject() : { ...u };
                const b = bookingMap.get(String(obj._id));
                const totalJobs = jobMap.get(String(obj._id)) || 0;
                return {
                    ...obj,
                    totalBookings: b?.totalBookings || 0,
                    completedBookings: b?.completedBookings || 0,
                    activeBookings: b?.activeBookings || 0,
                    totalSpent: b?.totalSpent || 0,
                    lastBookingAt: b?.lastBookingAt || null,
                    totalJobs,
                };
            });
        }
    } catch {
        users = rawUsers;
    }

    return paginatedResponse(res, 200, "Users fetched successfully", users, pageNum, limitNum, total);
});

/**
 * Get single user details for admin
 * @route GET /api/v1/admin/users/:id
 */
export const getUserDetails = asyncHandler(async (req: AdminAuthRequest, res) => {
    const user = await User.findById(req.params.id).populate("favorites", "-password -fcmToken -cnicNumber -cnicFrontImage -cnicBackImage -location -address -phone -email");
    if (!user) {
        throw new NotFoundError("User not found");
    }
    return successResponse(res, 200, "User details fetched successfully", user);
});

/**
 * 360° customer overview for the admin customer detail page (additive).
 * @route GET /api/v1/admin/users/:id/overview
 */
export const getUserOverview = asyncHandler(async (req: AdminAuthRequest, res) => {
    const id = String(req.params.id || "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new BadRequestError("Invalid user id");
    }

    const user = await User.findById(id)
        .select("-password -fcmToken")
        .populate("favorites", "fullName profileImage category hourlyRate rating city")
        .lean();
    if (!user) {
        throw new NotFoundError("User not found");
    }

    const customerId = new mongoose.Types.ObjectId(id);

    const [bookingAgg, recentBookings, jobCounts, recentJobs, disputes, reviews] = await Promise.all([
        Booking.aggregate([
            { $match: { customer: customerId } },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 },
                    amount: { $sum: { $ifNull: ["$totalAmount", 0] } },
                    last: { $max: "$createdAt" },
                },
            },
        ]),
        Booking.find({ customer: customerId })
            .sort({ createdAt: -1 })
            .limit(8)
            .populate("worker", "fullName profileImage phone category rating")
            .select("category status totalAmount bookingType scheduledDate createdAt worker address")
            .lean(),
        JobPost.aggregate([
            { $match: { customer: customerId } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        JobPost.find({ customer: customerId })
            .sort({ createdAt: -1 })
            .limit(6)
            .select("title category status createdAt budget pricing")
            .lean(),
        Dispute.find({ customer: customerId })
            .sort({ createdAt: -1 })
            .limit(6)
            .populate("worker", "fullName")
            .select("status reason createdAt booking worker raisedByType")
            .lean(),
        Review.find({ customer: customerId })
            .sort({ createdAt: -1 })
            .limit(6)
            .populate("worker", "fullName profileImage")
            .select("rating comment createdAt worker")
            .lean(),
    ]);

    const byStatus: Record<string, { count: number; amount: number }> = {};
    let totalBookings = 0;
    let lastBookingAt: Date | null = null;
    for (const row of bookingAgg as any[]) {
        byStatus[row._id] = { count: row.count, amount: row.amount };
        totalBookings += row.count;
        if (row.last && (!lastBookingAt || row.last > lastBookingAt)) lastBookingAt = row.last;
    }
    const jobsByStatus: Record<string, number> = {};
    let totalJobs = 0;
    for (const row of jobCounts as any[]) {
        jobsByStatus[row._id] = row.count;
        totalJobs += row.count;
    }

    const completed = byStatus.completed?.count || 0;
    const cancelled = byStatus.cancelled?.count || 0;
    const avgRatingGiven = reviews.length
        ? Math.round((reviews.reduce((s: number, r: any) => s + (r.rating || 0), 0) / reviews.length) * 10) / 10
        : null;

    return successResponse(res, 200, "User overview fetched successfully", {
        user,
        stats: {
            totalBookings,
            completedBookings: completed,
            cancelledBookings: cancelled,
            activeBookings: (byStatus.pending?.count || 0) + (byStatus.accepted?.count || 0) + (byStatus.ongoing?.count || 0),
            totalSpent: byStatus.completed?.amount || 0,
            completionRate: totalBookings ? Math.round((completed / totalBookings) * 100) : null,
            cancellationRate: totalBookings ? Math.round((cancelled / totalBookings) * 100) : null,
            totalJobs,
            jobsByStatus,
            openDisputes: disputes.filter((d: any) => d.status === "open" || d.status === "under_review").length,
            totalDisputes: disputes.length,
            reviewsGiven: reviews.length,
            avgRatingGiven,
            lastBookingAt,
        },
        recentBookings,
        recentJobs,
        disputes,
        reviews,
    });
});

/**
 * Activate / Deactivate a user
 * @route PATCH /api/v1/admin/users/:id/status
 */
export const toggleUserStatus = asyncHandler(async (req: AdminAuthRequest, res) => {
    const { id } = req.params;
    const { isActive } = req.body;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

    if (reason.length > 500) {
        throw new BadRequestError("Reason is too long");
    }

    if (isActive === undefined) {
        throw new BadRequestError("isActive field is required");
    }
    if (isActive === false && !reason) {
        throw new BadRequestError("Deactivation reason is required");
    }

    const user = await User.findByIdAndUpdate(
        id,
        isActive
            ? {
                isActive: true,
                deactivationReason: '',
                reactivatedAt: new Date(),
                reactivatedBy: req.admin?._id || null,
            }
            : {
                isActive: false,
                deactivationReason: reason,
                deactivatedAt: new Date(),
                deactivatedBy: req.admin?._id || null,
            },
        { new: true, runValidators: true }
    );

    if (!user) {
        throw new NotFoundError("User not found");
    }

    await recordAdminAction(req, {
        action: isActive ? 'user.activate' : 'user.deactivate',
        entityType: 'user',
        entityId: user._id.toString(),
        reason,
        metadata: {
            fullName: user.fullName,
            phone: user.phone,
            email: user.email,
            isActive: user.isActive,
            deactivationReason: user.deactivationReason || ''
        }
    });

    const message = isActive ? "User activated successfully" : "User deactivated successfully";
    return successResponse(res, 200, message, user);
});
