import { Response } from "express";
import mongoose, { Types } from "mongoose";
import { AuthRequest } from "../middlewares/jwt.middleware";
import { UploadRequest } from "../middlewares/multer.middleware";
import JobPost from "../models/JobPost";
import JobBid from "../models/JobBid";
import Worker from "../models/Workers";
import Booking from "../models/Booking";
import PromoCode from "../models/PromoCode";
import UserPromoUsage from "../models/UserPromoUsage";
import logger from "../config/logger";
import { syncPaymentForBookingStatus } from "../services/paymentLedgerService";
import { sendNotificationToRecipient } from "../services/notificationHelper";
import {
    buildInsufficientBalanceMessage,
    calculateCommissionAmount,
    getWalletEligibility
} from "../services/workerWalletService";
import {
    buildAvailableWorkerFilterForJobType,
    getEnabledJobTypesForWorker,
    workerAcceptsJobType
} from "../services/workerJobAvailabilityService";
import { reserveCommission } from "../services/commissionReservationService";
import { getWalletSettings } from "../services/walletSettingsService";
import { getIO } from "../sockets/socketManager";
import {
    buildWorkerSpecialtyCategoryFilter,
    getWorkerMatchedSpecialtyProfile,
    getWorkerActiveSpecialtyNames,
    workerCanPerformCategory
} from "../services/workerSpecialtyService";

const MAX_BIDS = 5;
const DEFAULT_JOB_RADIUS_METERS = 100000;
const WORKER_BID_PROFILE_SELECT = 'fullName phone email profileImage category rating totalReviews totalJobs hourlyRate experience city address bio skills isVerified isAvailable';
const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toPlainObject = (doc: any) => doc?.toObject ? doc.toObject() : doc;
const uniqueUrls = (urls: (string | undefined | null)[]) =>
    Array.from(new Set(urls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)));
const toPublicAreaLabel = (address?: string) => {
    const parts = String(address || '').split(',').map(part => part.trim()).filter(Boolean);
    if (parts.length >= 3) return parts.slice(-2).join(', ');
    if (parts.length === 2) return parts[1] || 'Nearby service area';
    return 'Nearby service area';
};

const getCustomerId = (job: any) => {
    const customer = job?.customer;
    return (customer?._id || customer)?.toString?.() || '';
};

const buildJobMediaMeta = (job: any) => {
    const images = uniqueUrls([job.imageUrl, ...(Array.isArray(job.imageUrls) ? job.imageUrls : [])]);
    const videos = uniqueUrls([job.videoUrl, ...(Array.isArray(job.videoUrls) ? job.videoUrls : [])]);
    const audios = uniqueUrls(Array.isArray(job.audioUrls) ? job.audioUrls : []);
    return {
        images,
        videos,
        audios,
        coverUrl: images[0] || '',
        totalCount: images.length + videos.length + audios.length,
        hasVideo: videos.length > 0,
        hasAudio: audios.length > 0,
    };
};

const formatJobDate = (date?: Date | string) => {
    const parsedDate = date ? new Date(date) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
        return {
            dateLabel: 'Today',
            dayLabel: '',
            fullDateLabel: 'Today',
        };
    }

    return {
        dateLabel: parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        dayLabel: parsedDate.toLocaleDateString('en-US', { weekday: 'short' }),
        fullDateLabel: parsedDate.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        }),
    };
};

const calculateDistanceMeters = (from?: number[], to?: number[]) => {
    if (!Array.isArray(from) || !Array.isArray(to) || from.length < 2 || to.length < 2) return null;
    const fromLongitude = Number(from[0]);
    const fromLatitude = Number(from[1]);
    const toLongitude = Number(to[0]);
    const toLatitude = Number(to[1]);
    if (![fromLongitude, fromLatitude, toLongitude, toLatitude].every(Number.isFinite)) return null;

    const radius = 6371e3;
    const latitudeDelta = ((toLatitude - fromLatitude) * Math.PI) / 180;
    const longitudeDelta = ((toLongitude - fromLongitude) * Math.PI) / 180;
    const fromLatitudeRadians = (fromLatitude * Math.PI) / 180;
    const toLatitudeRadians = (toLatitude * Math.PI) / 180;
    const a = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(fromLatitudeRadians) * Math.cos(toLatitudeRadians) * Math.sin(longitudeDelta / 2) ** 2;

    return Math.round(radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

const formatDistance = (meters: number | null) => {
    if (meters === null) return 'Nearby';
    if (meters < 1000) return `${meters} m`;
    return `${(meters / 1000).toFixed(1)} km`;
};

const buildCustomerStatsById = async (jobDocs: any[]) => {
    const ids = uniqueUrls(jobDocs.map(jobDoc => getCustomerId(toPlainObject(jobDoc))))
        .filter(id => Types.ObjectId.isValid(id));

    if (ids.length === 0) return new Map<string, { totalJobs: number; completedJobs: number }>();

    const rows = await Booking.aggregate([
        { $match: { customer: { $in: ids.map(id => new Types.ObjectId(id)) } } },
        {
            $group: {
                _id: '$customer',
                totalJobs: { $sum: 1 },
                completedJobs: {
                    $sum: {
                        $cond: [{ $eq: ['$status', 'completed'] }, 1, 0]
                    }
                }
            }
        }
    ]);

    return new Map(
        rows.map((row: any) => [
            row._id.toString(),
            {
                totalJobs: Number(row.totalJobs || 0),
                completedJobs: Number(row.completedJobs || 0),
            }
        ])
    );
};

const buildWorkerJobSignalPayload = (
    jobDoc: any,
    customerStatsById = new Map<string, { totalJobs: number; completedJobs: number }>(),
    workerProfile?: any
) => {
    const job = toPlainObject(jobDoc);
    const customer = typeof job.customer === 'object' ? job.customer : null;
    const customerId = getCustomerId(job);
    const customerStats = customerStatsById.get(customerId) || { totalJobs: 0, completedJobs: 0 };
    const media = buildJobMediaMeta(job);
    const schedule = formatJobDate(job.scheduledDate || job.createdAt);
    const clientBudget = Number(job.amount || 0);
    const offerAmount = Number(clientBudget || workerProfile?.hourlyRate || 0);
    const distanceMeters = calculateDistanceMeters(workerProfile?.location?.coordinates, job.location?.coordinates);
    const responseWindowSeconds = Math.max(0, Math.floor((new Date(job.expiresAt).getTime() - Date.now()) / 1000));

    return {
        ...job,
        address: toPublicAreaLabel(job.address),
        media,
        clientMeta: {
            _id: customer?._id || customerId,
            fullName: customer?.fullName || 'Client',
            profileImage: customer?.profileImage || '',
            rating: customer?.rating ?? null,
            totalReviews: customer?.totalReviews ?? 0,
            totalJobs: customerStats.totalJobs,
            completedJobs: customerStats.completedJobs,
        },
        signalMeta: {
            title: job.category,
            description: job.description,
            missionKind: job.urgency,
            missionKindLabel: job.urgency === 'instant' ? 'Instant response' : 'Scheduled mission',
            evidenceCount: media.totalCount,
            hasMedia: media.totalCount > 0,
            amount: offerAmount,
            amountText: offerAmount > 0 ? `Rs. ${offerAmount.toLocaleString()}` : 'Open budget',
            clientBudget,
            clientBudgetText: clientBudget > 0 ? `Rs. ${clientBudget.toLocaleString()}` : 'Open budget',
            distanceMeters,
            distanceText: formatDistance(distanceMeters),
            expiresAt: job.expiresAt,
            responseWindowSeconds,
            schedule: {
                ...schedule,
                timeLabel: job.scheduledTime || (job.urgency === 'instant' ? 'ASAP' : ''),
            },
            location: {
                address: toPublicAreaLabel(job.address),
            },
        },
    };
};

const buildPersonalizedWorkerJobSignalPayload = async (
    jobDoc: any,
    customerStatsById: Map<string, { totalJobs: number; completedJobs: number }>,
    workerProfile: any
) => {
    const job = toPlainObject(jobDoc);
    const matchedSpecialtyProfile = await getWorkerMatchedSpecialtyProfile(workerProfile, job.category);
    const workerForPayload = matchedSpecialtyProfile
        ? { ...(workerProfile?.toObject ? workerProfile.toObject() : workerProfile), hourlyRate: matchedSpecialtyProfile.hourlyRate }
        : workerProfile;
    const payload = buildWorkerJobSignalPayload(jobDoc, customerStatsById, workerForPayload);
    const offerAmount = Number(payload.signalMeta.amount || 0);
    const estimatedCommission = await calculateCommissionAmount(offerAmount);
    const walletEligibility = workerProfile?._id
        ? await getWalletEligibility(workerProfile._id, estimatedCommission)
        : null;

    return {
        ...payload,
        signalMeta: {
            ...payload.signalMeta,
            estimatedCommission,
            estimatedCommissionText: `Rs. ${estimatedCommission.toLocaleString()}`,
            estimatedNetEarning: Math.max(0, offerAmount - estimatedCommission),
            estimatedNetEarningText: `Rs. ${Math.max(0, offerAmount - estimatedCommission).toLocaleString()}`,
            requiredWalletBalance: walletEligibility?.requiredBalance ?? 0,
            walletBalance: walletEligibility?.availableBalance ?? walletEligibility?.balance ?? 0,
            walletTotalBalance: walletEligibility?.balance ?? 0,
            walletReservedBalance: walletEligibility?.reservedBalance ?? 0,
            isWalletEligible: walletEligibility?.isEligible ?? true,
            matchedSpecialtyProfile,
        }
    };
};



const buildJobPostCardPayloadsBatch = async (jobsDoc: any[]) => {
    if (jobsDoc.length === 0) return [];

    const jobs = jobsDoc.map(toPlainObject);
    const jobIds = jobs.map(j => j._id);

    // 1. Batch count all bids and pending bids using aggregation
    const bidStats = await JobBid.aggregate([
        { $match: { jobPost: { $in: jobIds } } },
        {
            $group: {
                _id: "$jobPost",
                totalBids: { $sum: 1 },
                pendingBids: {
                    $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] }
                }
            }
        }
    ]);

    // Map stats for easy lookup
    const statsMap = new Map(bidStats.map(s => [s._id.toString(), s]));

    // 2. Batch fetch accepted bids for these jobs
    const acceptedBids = await JobBid.find({
        jobPost: { $in: jobIds },
        status: 'accepted'
    }).populate('worker', WORKER_BID_PROFILE_SELECT);

    const acceptedBidsMap = new Map(acceptedBids.map(b => [b.jobPost.toString(), b]));

    // 3. Construct payload for each job matching original structure perfectly
    return jobs.map(job => {
        const jobIdStr = job._id.toString();
        const stats = statsMap.get(jobIdStr) || { totalBids: 0, pendingBids: 0 };
        const bidCount = stats.totalBids;
        const pendingBidCount = stats.pendingBids;
        const acceptedBid = acceptedBidsMap.get(jobIdStr);

        const acceptedWorker = acceptedBid?.worker as any;
        const primaryImageUrl = acceptedWorker?.profileImage || job.imageUrls?.[0] || job.imageUrl || '';
        const media = buildJobMediaMeta(job);

        const counterParty = acceptedWorker ? {
            _id: acceptedWorker._id,
            fullName: acceptedWorker.fullName,
            phone: acceptedWorker.phone || '',
            email: acceptedWorker.email || '',
            profileImage: acceptedWorker.profileImage || '',
            roleLabel: 'Accepted Ustad',
            category: acceptedWorker.category || '',
            rating: acceptedWorker.rating || 0,
            totalJobs: acceptedWorker.totalJobs || 0,
        } : {
            fullName: bidCount > 0 ? `${bidCount} bids received` : 'Open broadcast',
            profileImage: primaryImageUrl,
            roleLabel: bidCount > 0 ? 'Bids' : 'Mission',
        };

        return {
            ...job,
            bidCount,
            pendingBidCount,
            acceptedBid: acceptedBid ? {
                _id: acceptedBid._id,
                proposedPrice: acceptedBid.proposedPrice,
                message: acceptedBid.message,
                status: acceptedBid.status,
                worker: acceptedWorker || null,
            } : null,
            cardMeta: {
                source: 'job_post',
                title: job.category,
                description: job.description,
                missionKind: job.urgency,
                primaryImageUrl,
                media,
                counterParty,
                financial: {
                    label: acceptedBid ? 'Accepted Bid' : 'Budget',
                    amount: Number(acceptedBid?.proposedPrice || job.amount || 0),
                    currency: 'PKR',
                },
                bidSummary: {
                    total: bidCount,
                    pending: pendingBidCount,
                    hasAcceptedBid: Boolean(acceptedBid),
                }
            }
        };
    });
};

const reconcileAssignedJobPost = async (jobDoc: any) => {
    if (jobDoc.status !== 'assigned') return jobDoc;

    const acceptedBid = await JobBid.findOne({
        jobPost: jobDoc._id,
        status: 'accepted'
    }).select('worker');

    if (!acceptedBid) return jobDoc;

    const responseWindowEnd = new Date(jobDoc.expiresAt);
    responseWindowEnd.setMinutes(responseWindowEnd.getMinutes() + 5);
    const createdAtWindow = Number.isNaN(responseWindowEnd.getTime())
        ? { $gte: jobDoc.createdAt }
        : { $gte: jobDoc.createdAt, $lte: responseWindowEnd };
    const legacyBookingMatch = {
        customer: jobDoc.customer?._id || jobDoc.customer,
        worker: acceptedBid.worker,
        category: jobDoc.category,
        description: jobDoc.description,
        address: jobDoc.address,
        bookingType: jobDoc.urgency,
        createdAt: createdAtWindow
    };

    const booking = await Booking.findOne({
        $or: [
            { jobPost: jobDoc._id },
            {
                $and: [
                    { $or: [{ jobPost: { $exists: false } }, { jobPost: null }] },
                    legacyBookingMatch
                ]
            }
        ]
    }).sort({ createdAt: 1 });

    if (!booking) return jobDoc;

    if (!booking.jobPost) {
        booking.jobPost = jobDoc._id;
        await booking.save();
    }

    if (booking.status === 'completed' || booking.status === 'cancelled') {
        jobDoc.status = booking.status === 'completed' ? 'closed' : 'cancelled';
        await jobDoc.save();
    }

    return jobDoc;
};

const buildJobPostDetailPayload = async (
    jobDoc: any,
    customerStatsById = new Map<string, { totalJobs: number; completedJobs: number }>()
) => {
    const job = toPlainObject(jobDoc);
    const customer = typeof job.customer === 'object' ? job.customer : null;
    const customerId = getCustomerId(job);
    const customerStats = customerStatsById.get(customerId) || { totalJobs: 0, completedJobs: 0 };
    const media = buildJobMediaMeta(job);
    const schedule = formatJobDate(job.scheduledDate || job.createdAt);
    const [bidCount, pendingBidCount, acceptedBidCount] = await Promise.all([
        JobBid.countDocuments({ jobPost: job._id }),
        JobBid.countDocuments({ jobPost: job._id, status: 'pending' }),
        JobBid.countDocuments({ jobPost: job._id, status: 'accepted' }),
    ]);
    const statusInfo = job.status === 'cancelled'
        ? { value: job.status, label: 'Cancelled', tone: 'danger', accentColor: '#FF3B30' }
        : job.status === 'assigned'
            ? { value: job.status, label: 'Ustad assigned', tone: 'success', accentColor: '#00FF7F' }
            : job.status === 'reviewing'
                ? { value: job.status, label: 'Reviewing proposals', tone: 'warning', accentColor: '#FF8C00' }
                : job.status === 'closed'
                    ? { value: job.status, label: 'Closed', tone: 'neutral', accentColor: '#8E8E93' }
                    : { value: job.status, label: 'Open request', tone: 'info', accentColor: '#00F5FF' };
    const budget = Number(job.amount || 0);

    return {
        ...job,
        bidCount,
        pendingBidCount,
        media,
        clientMeta: {
            _id: customer?._id || customerId,
            fullName: customer?.fullName || 'Client',
            profileImage: customer?.profileImage || '',
            phone: customer?.phone || '',
            totalJobs: customerStats.totalJobs,
            completedJobs: customerStats.completedJobs,
        },
        detailMeta: {
            statusInfo,
            missionKind: job.urgency,
            missionKindLabel: job.urgency === 'instant' ? 'Instant visit' : 'Scheduled visit',
            schedule: {
                ...schedule,
                timeLabel: job.scheduledTime || (job.urgency === 'instant' ? 'ASAP' : ''),
            },
            location: {
                address: toPublicAreaLabel(job.address),
            },
            financial: {
                label: 'Client budget',
                amount: budget,
                amountText: budget > 0 ? `Rs. ${budget.toLocaleString()}` : 'Open budget',
                currency: 'PKR',
            },
            bidSummary: {
                total: bidCount,
                pending: pendingBidCount,
                hasAcceptedBid: acceptedBidCount > 0,
            },
            media,
        },
    };
};

const buildWorkerBidCardPayload = (
    bidDoc: any,
    customerStatsById = new Map<string, { totalJobs: number; completedJobs: number }>()
) => {
    const bid = toPlainObject(bidDoc);
    const job = typeof bid.jobPost === 'object' ? bid.jobPost : null;
    if (!job) return bid;

    const customer = typeof job.customer === 'object' ? job.customer : null;
    const customerId = getCustomerId(job);
    const customerStats = customerStatsById.get(customerId) || { totalJobs: 0, completedJobs: 0 };
    const media = buildJobMediaMeta(job);
    const schedule = formatJobDate(job.scheduledDate || job.createdAt);
    const quotedAmount = Number(bid.proposedPrice || job.amount || 0);
    const statusInfo = bid.status === 'accepted'
        ? { value: bid.status, label: 'Accepted', tone: 'success', accentColor: '#00FF7F' }
        : bid.status === 'rejected'
            ? { value: bid.status, label: 'Declined', tone: 'danger', accentColor: '#FF3B30' }
            : { value: bid.status, label: 'Awaiting client', tone: 'warning', accentColor: '#FF8C00' };

    return {
        ...bid,
        cardMeta: {
            source: 'worker_bid',
            title: job.category,
            description: job.description,
            missionKind: job.urgency,
            missionKindLabel: job.urgency === 'instant' ? 'Instant visit' : 'Scheduled visit',
            primaryImageUrl: customer?.profileImage || '',
            media,
            statusInfo,
            schedule: {
                ...schedule,
                timeLabel: job.scheduledTime || (job.urgency === 'instant' ? 'ASAP' : ''),
            },
            location: {
                address: toPublicAreaLabel(job.address),
            },
            counterParty: {
                _id: customer?._id || customerId,
                fullName: customer?.fullName || 'Client',
                profileImage: customer?.profileImage || '',
                roleLabel: 'Client',
                totalJobs: customerStats.totalJobs,
                completedJobs: customerStats.completedJobs,
            },
            financial: {
                label: 'Your quote',
                amount: quotedAmount,
                amountText: quotedAmount > 0 ? `Rs. ${quotedAmount.toLocaleString()}` : 'Open quote',
                currency: 'PKR',
            },
            actionLabel: 'View details',
            submittedAt: bid.createdAt,
        }
    };
};

/**
 * @description Create a new open Job Post
 * @route POST /api/v1/jobs
 * @access Private (User)
 */
export const createJobPost = async (req: AuthRequest, res: Response) => {
    try {
        const customerId = req.tokenPayload?.id;
        if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const {
            category, description, urgency,
            longitude, latitude, address,
            imageUrl, imageUrls, videoUrl, videoUrls, audioUrls, amount
        } = req.body;

        let { scheduledDate, scheduledTime } = req.body;
        const clientOffer = Number(amount);

        if (!Number.isFinite(clientOffer) || clientOffer <= 0) {
            return res.status(400).json({
                success: false,
                message: "A positive client offer is required so workers can make an informed decision."
            });
        }

        if (urgency === 'instant') {
            const now = new Date();
            scheduledDate = now;
            scheduledTime = now.toTimeString().split(' ')[0]?.substring(0, 5) || "00:00";
        } else {
            if (!scheduledDate || !scheduledTime) {
                return res.status(400).json({ success: false, message: "Scheduled date and time are required for scheduled jobs" });
            }
        }

        if (longitude === undefined || latitude === undefined) {
            return res.status(400).json({ success: false, message: "Location coordinates (longitude, latitude) are required" });
        }

        const expiresAt = urgency === 'instant'
            ? new Date(Date.now() + 10 * 60 * 1000) // 10 minutes for instant
            : new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours for scheduled

        const jobPost = await JobPost.create({
            customer: customerId,
            category,
            description,
            urgency,
            scheduledDate,
            scheduledTime,
            address,
            location: {
                type: "Point",
                coordinates: [longitude, latitude]
            },
            imageUrl,
            imageUrls,
            videoUrl,
            videoUrls,
            audioUrls,
            amount: clientOffer,
            pricing: {
                clientOffer,
                currency: 'PKR',
                pricingVersion: 2
            },
            expiresAt
        });

        const populatedJobPost = await JobPost.findById(jobPost._id)
            .populate('customer', 'fullName profileImage phone');
        const customerStats = await buildCustomerStatsById(populatedJobPost ? [populatedJobPost] : [jobPost]);
        const signalPayload = buildWorkerJobSignalPayload(populatedJobPost || jobPost, customerStats);

        // 1. Emit socket event
        const io = getIO();

        // Broadcast to relevant workers
        logger.info(`📡 Job Broadcast: Finding workers for category: ${category} at [${longitude}, ${latitude}]`);

        const categoryFilter = await buildWorkerSpecialtyCategoryFilter(category);
        const nearbyWorkers = await Worker.find({
            ...categoryFilter,
            ...buildAvailableWorkerFilterForJobType(urgency),
            location: {
                $near: {
                    $geometry: { type: "Point", coordinates: [longitude, latitude] },
                    $maxDistance: DEFAULT_JOB_RADIUS_METERS
                }
            }
        }).limit(10).select('_id category specialties hourlyRate location');

        logger.info(`📡 Found ${nearbyWorkers.length} workers to notify: ${nearbyWorkers.map(w => w._id).join(', ')}`);

        // Broadcast to relevant workers via sockets and push notifications
        await Promise.all(nearbyWorkers.map(async worker => {
            const personalizedSignal = await buildPersonalizedWorkerJobSignalPayload(populatedJobPost || jobPost, customerStats, worker);
            io.to(`worker:${worker._id.toString()}`).emit('job:new', personalizedSignal);

            sendNotificationToRecipient(
                worker._id,
                'worker',
                `New ${category} Job Post Available!`,
                `A new job post is available near you: "${description.substring(0, 100)}${description.length > 100 ? '...' : ''}"`,
                { jobId: jobPost._id.toString(), type: 'new_job' }
            ).catch(err => logger.error(`Failed to send job post push notification to worker ${worker._id}:`, err));
        }));

        res.status(201).json({
            success: true,
            data: signalPayload,
            message: `Job post created and broadcasted to ${nearbyWorkers.length} workers.`
        });
    } catch (error: any) {
        logger.error("Error in createJobPost:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Submit a bid for a Job Post
 * @route POST /api/v1/jobs/:jobId/bids
 * @access Private (Worker)
 */
export const submitBid = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        if (!workerId || req.tokenPayload?.type !== 'worker') {
            return res.status(401).json({ success: false, message: "Unauthorized as worker" });
        }

        const { jobId } = req.params;
        const { message, proposedPrice, estimatedDays } = req.body;
        const proposedAmount = Number(proposedPrice);

        const jobPost = await JobPost.findById(jobId);
        if (!jobPost) return res.status(404).json({ success: false, message: "Job post not found" });

        const workerProfile = await Worker.findById(workerId)
            .select('isAvailable isActive isVerified isInstantAvailable isScheduledAvailable');
        if (!workerAcceptsJobType(workerProfile, jobPost.urgency)) {
            return res.status(403).json({
                success: false,
                message: `${jobPost.urgency === 'instant' ? 'Instant' : 'Scheduled'} job availability is turned off. Enable it before responding to this job.`
            });
        }

        if (jobPost.status !== 'open') {
            return res.status(400).json({ success: false, message: "This job is no longer open for bids" });
        }

        if (jobPost.expiresAt < new Date()) {
            return res.status(400).json({ success: false, message: "This job post has expired" });
        }
        if (!await workerCanPerformCategory(workerId, jobPost.category)) {
            return res.status(403).json({ success: false, message: "This job does not match an active approved specialty on your profile." });
        }

        if (!Number.isFinite(proposedAmount) || proposedAmount <= 0) {
            return res.status(400).json({ success: false, message: "Proposed price must be a positive number" });
        }
        if (!String(message || '').trim()) {
            return res.status(400).json({ success: false, message: "A short proposal message is required" });
        }

        const estimatedCommission = await calculateCommissionAmount(proposedAmount);
        const walletSettings = await getWalletSettings();
        const clientOffer = Number(jobPost.pricing?.clientOffer ?? jobPost.amount ?? 0);
        const walletEligibility = await getWalletEligibility(workerId, estimatedCommission);
        if (!walletEligibility.isEligible) {
            return res.status(402).json({
                success: false,
                requiredBalance: walletEligibility.requiredBalance,
                currentBalance: walletEligibility.availableBalance,
                message: buildInsufficientBalanceMessage(walletEligibility.requiredBalance, walletEligibility.availableBalance)
            });
        }

        // Check Max Bids
        const bidCount = await JobBid.countDocuments({ jobPost: jobId });
        if (bidCount >= MAX_BIDS && jobPost.urgency !== 'instant') {
            return res.status(400).json({ success: false, message: "Maximum number of bids reached for this job." });
        }

        // Create Bid
        const parsedEstimatedDays = estimatedDays ? Number(estimatedDays) : undefined;
        const newBid = await JobBid.create({
            jobPost: jobId,
            worker: workerId,
            message: String(message).trim(),
            proposedPrice: proposedAmount,
            priceMode: proposedAmount === clientOffer ? 'accepted_offer' : 'counter_offer',
            clientOfferSnapshot: clientOffer,
            commissionRateSnapshot: walletSettings.commissionEnabled ? walletSettings.platformFeePercentage : 0,
            ...(Number.isFinite(parsedEstimatedDays) && parsedEstimatedDays! > 0 ? { estimatedDays: parsedEstimatedDays } : {}),
        });

        // Cap Bidding: if we just hit the MAX_BIDS, change job status to reviewing
        if ((bidCount + 1) >= MAX_BIDS && jobPost.urgency !== 'instant') {
            jobPost.status = 'reviewing';
            await jobPost.save();
        }

        const io = getIO();

        // Notify Client immediately
        await newBid.populate('worker', WORKER_BID_PROFILE_SELECT);
        io.to(`user:${jobPost.customer.toString()}`).emit('bid:new', newBid);
        io.to(`worker:${workerId.toString()}`).emit('bid:submitted', { bidId: newBid._id, jobId: jobPost._id });

        res.status(201).json({
            success: true,
            data: newBid,
            message: "Bid submitted successfully"
        });

    } catch (error: any) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: "You have already placed a bid on this job." });
        }
        logger.error("Error in submitBid:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Accept a Bid and create a Booking
 * @route POST /api/v1/jobs/bids/:bidId/accept
 * @access Private (User)
 */
export const acceptBid = async (req: AuthRequest, res: Response) => {
    const session = await mongoose.startSession();
    try {
        const customerId = req.tokenPayload?.id;
        const { bidId } = req.params;
        const { promoCode } = req.body;
        let bid: any = null;
        let jobPost: any = null;
        let booking: any = null;

        await session.withTransaction(async () => {
            bid = await JobBid.findOne({ _id: bidId, status: 'pending' }).session(session);
            if (!bid) {
                const error = new Error("Bid is no longer available");
                (error as any).statusCode = 409;
                throw error;
            }

            jobPost = await JobPost.findOne({ _id: bid.jobPost, status: { $in: ['open', 'reviewing'] } }).session(session);
            if (!jobPost) {
                const error = new Error("Job is no longer available for assignment");
                (error as any).statusCode = 409;
                throw error;
            }

            if (jobPost.customer.toString() !== customerId) {
                const error = new Error("Forbidden");
                (error as any).statusCode = 403;
                throw error;
            }

            const agreedPrice = Number(bid.proposedPrice);
            const commissionAmount = await calculateCommissionAmount(agreedPrice);
            const walletSettings = await getWalletSettings();
            const walletEligibility = await getWalletEligibility(bid.worker, commissionAmount, session);
            if (!walletEligibility.isEligible) {
                const error = new Error(buildInsufficientBalanceMessage(walletEligibility.requiredBalance, walletEligibility.availableBalance));
                (error as any).statusCode = 402;
                (error as any).requiredBalance = walletEligibility.requiredBalance;
                (error as any).currentBalance = walletEligibility.availableBalance;
                throw error;
            }

            const workerProfile = await Worker.findById(bid.worker).session(session);
            const workerNetIncome = Math.max(0, agreedPrice - commissionAmount);
            const clientOffer = Number(bid.clientOfferSnapshot || jobPost.pricing?.clientOffer || jobPost.amount || 0);

            // Promo code validation & computation
            let discountAmount = 0;
            let promoId: mongoose.Types.ObjectId | null = null;

            if (promoCode) {
                const uppercaseCode = promoCode.trim().toUpperCase();
                const promo = await PromoCode.findOne({ code: uppercaseCode }).session(session);
                if (!promo) {
                    const error = new Error("Invalid promo code");
                    (error as any).statusCode = 400;
                    throw error;
                }
                if (!promo.isActive) {
                    const error = new Error("This promo code is no longer active");
                    (error as any).statusCode = 400;
                    throw error;
                }
                const now = new Date();
                if (now < promo.startDate) {
                    const error = new Error("This promo code has not started yet");
                    (error as any).statusCode = 400;
                    throw error;
                }
                if (now > promo.endDate) {
                    const error = new Error("This promo code has expired");
                    (error as any).statusCode = 400;
                    throw error;
                }
                if (agreedPrice < promo.minBookingAmount) {
                    const error = new Error(`Minimum booking amount to use this code is Rs. ${promo.minBookingAmount}`);
                    (error as any).statusCode = 400;
                    throw error;
                }
                if (promo.usageLimit > 0 && promo.usageCount >= promo.usageLimit) {
                    const error = new Error("This promo code global limit has been reached");
                    (error as any).statusCode = 400;
                    throw error;
                }

                // Check user usage limit
                const userUsage = await UserPromoUsage.countDocuments({
                    user: customerId,
                    promoCode: promo._id
                }).session(session);
                if (userUsage >= promo.userUsageLimit) {
                    const error = new Error("You have exceeded the usage limit for this promo code");
                    (error as any).statusCode = 400;
                    throw error;
                }

                // Calculate discount amount
                if (promo.discountType === 'fixed') {
                    discountAmount = promo.discountValue;
                } else {
                    discountAmount = (agreedPrice * promo.discountValue) / 100;
                    if (promo.maxDiscountAmount > 0 && discountAmount > promo.maxDiscountAmount) {
                        discountAmount = promo.maxDiscountAmount;
                    }
                }

                discountAmount = Math.min(discountAmount, agreedPrice);
                promoId = promo._id as mongoose.Types.ObjectId;
            }

            const [createdBooking] = await Booking.create([{
                jobPost: jobPost._id,
                acceptedBid: bid._id,
                customer: customerId,
                worker: bid.worker,
                category: jobPost.category,
                description: jobPost.description,
                scheduledDate: jobPost.scheduledDate,
                scheduledTime: jobPost.scheduledTime,
                estimatedHours: 1,
                hourlyRate: workerProfile ? workerProfile.hourlyRate : 0,
                subtotal: agreedPrice,
                platformFee: commissionAmount,
                totalAmount: agreedPrice - discountAmount,
                workerEarning: workerNetIncome,
                agreement: {
                    clientOffer,
                    agreedPrice,
                    cashDue: agreedPrice - discountAmount,
                    priceSource: bid.priceMode || (agreedPrice === clientOffer ? 'accepted_offer' : 'counter_offer'),
                    commissionRateSnapshot: walletSettings.commissionEnabled ? walletSettings.platformFeePercentage : 0,
                    commissionAmount,
                    workerNetIncome,
                    promoCode: promoCode ? promoCode.trim().toUpperCase() : undefined,
                    discountAmount,
                    lockedAt: new Date(),
                    pricingVersion: 2
                },
                address: jobPost.address,
                location: jobPost.location,
                imageUrls: jobPost.imageUrls || [],
                videoUrls: jobPost.videoUrls || [],
                audioUrls: jobPost.audioUrls || [],
                bookingType: jobPost.urgency,
                status: 'accepted',
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
            }], { session });
            if (!createdBooking) throw new Error("Unable to create booking");
            booking = createdBooking;

            // Track promo usage
            if (promoId) {
                await UserPromoUsage.create([{
                    user: customerId,
                    promoCode: promoId,
                    booking: booking._id,
                    usedAt: new Date()
                }], { session });

                await PromoCode.findByIdAndUpdate(promoId, {
                    $inc: { usageCount: 1 }
                }).session(session);
            }

            await reserveCommission({
                workerId: bid.worker,
                bookingId: booking._id,
                jobPostId: jobPost._id,
                bidId: bid._id,
                amount: commissionAmount,
                commissionRateSnapshot: walletSettings.commissionEnabled ? walletSettings.platformFeePercentage : 0
            }, { session });

            jobPost.status = 'assigned';
            await jobPost.save({ session });
            bid.status = 'accepted';
            await bid.save({ session });
            await JobBid.updateMany(
                { jobPost: jobPost._id, _id: { $ne: bid._id } },
                { $set: { status: 'rejected' } },
                { session }
            );
            await syncPaymentForBookingStatus(booking, session);
        });

        // Notify winner and losers via sockets and push notifications
        const io = getIO();
        io.to(`worker:${bid.worker.toString()}`).emit('bid:won', { jobPost, booking });

        sendNotificationToRecipient(
            bid.worker,
            'worker',
            'Bid Accepted! 🎉',
            `Your bid for "${jobPost.category}" has been accepted! A booking has been created.`,
            { bookingId: booking._id.toString(), type: 'bid_won' }
        ).catch(err => logger.error(`Failed to send bid acceptance push notification to worker ${bid.worker}:`, err));

        const otherBids = await JobBid.find({ jobPost: jobPost._id, _id: { $ne: bid._id } });
        otherBids.forEach(ob => {
            io.to(`worker:${ob.worker.toString()}`).emit('bid:lost', { jobPost });
        });

        res.status(200).json({
            success: true,
            data: booking,
            message: "Bid accepted and booking created."
        });

    } catch (error: any) {
        logger.error("Error in acceptBid:", error);
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Internal server error",
            ...(error.requiredBalance !== undefined ? { requiredBalance: error.requiredBalance } : {}),
            ...(error.currentBalance !== undefined ? { currentBalance: error.currentBalance } : {})
        });
    } finally {
        await session.endSession();
    }
};

/**
 * @description Get a single Job Post
 * @route GET /api/v1/jobs/:jobId
 * @access Private (User, Worker, Admin)
 */
export const getJobPostById = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const userId = req.tokenPayload?.id;
        const userType = req.tokenPayload?.type;
        const userRole = req.tokenPayload?.role;
        const isAdmin = userType === 'admin' || userRole === 'admin' || userRole === 'superadmin';

        const jobPost = await JobPost.findById(jobId)
            .populate('customer', 'fullName profileImage phone');

        if (!jobPost) {
            return res.status(404).json({ success: false, message: "Job post not found" });
        }

        const customerId = (jobPost.customer as any)?._id?.toString?.() || jobPost.customer.toString();
        const isOwner = customerId === userId;

        if (userType === 'user' && !isOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }

        const stats = await buildCustomerStatsById([jobPost]);
        const workerProfile = userType === 'worker'
            ? await Worker.findById(userId).select('_id category specialties hourlyRate location')
            : null;
        const detailPayload = await buildJobPostDetailPayload(jobPost, stats);
        const personalizedPayload = userType === 'worker' && workerProfile
            ? await buildPersonalizedWorkerJobSignalPayload(jobPost, stats, workerProfile)
            : null;
        const jobWithBidCount = personalizedPayload
            ? { ...detailPayload, ...personalizedPayload, detailMeta: detailPayload.detailMeta }
            : detailPayload;
        if (userType === 'worker' && !isAdmin) {
            const publicArea = toPublicAreaLabel((jobPost as any).address);
            jobWithBidCount.address = publicArea;
            if (jobWithBidCount.clientMeta) jobWithBidCount.clientMeta.phone = '';
            if (jobWithBidCount.detailMeta?.location) jobWithBidCount.detailMeta.location.address = publicArea;
            if (jobWithBidCount.signalMeta?.location) jobWithBidCount.signalMeta.location.address = publicArea;
        }

        res.status(200).json({ success: true, data: jobWithBidCount });
    } catch (error: any) {
        logger.error("Error in getJobPostById:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get Jobs nearby for a Worker
 * @route GET /api/v1/jobs/nearby
 */
export const getNearbyJobs = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        const worker = await Worker.findById(workerId)
            .select('category specialties location hourlyRate isActive isVerified isAvailable isInstantAvailable isScheduledAvailable');

        if (!worker) {
            return res.status(404).json({ success: false, message: "Worker not found" });
        }

        const queryLongitude = req.query.longitude ? parseFloat(req.query.longitude as string) : undefined;
        const queryLatitude = req.query.latitude ? parseFloat(req.query.latitude as string) : undefined;
        const savedLongitude = worker.location?.coordinates?.[0];
        const savedLatitude = worker.location?.coordinates?.[1];

        const longitude = Number.isFinite(queryLongitude) ? queryLongitude : savedLongitude;
        const latitude = Number.isFinite(queryLatitude) ? queryLatitude : savedLatitude;

        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
            return res.status(400).json({ success: false, message: "Worker location coordinates are required" });
        }

        const requestedCategory = req.query.category as string | undefined;
        const activeWorkerCategories = await getWorkerActiveSpecialtyNames(worker);
        const workerCategories = requestedCategory
            ? activeWorkerCategories.filter((category) => category.toLowerCase() === requestedCategory.toLowerCase())
            : activeWorkerCategories;
        if (workerCategories.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }
        const enabledJobTypes = getEnabledJobTypesForWorker(worker);
        if (enabledJobTypes.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }
        const maxDistance = req.query.radius
            ? Math.min(parseInt(req.query.radius as string, 10) || DEFAULT_JOB_RADIUS_METERS, DEFAULT_JOB_RADIUS_METERS)
            : DEFAULT_JOB_RADIUS_METERS;

        const query: any = {
            status: 'open',
            expiresAt: { $gt: new Date() },
            location: {
                $near: {
                    $geometry: { type: "Point", coordinates: [longitude, latitude] },
                    $maxDistance: maxDistance
                }
            }
        };

        if (workerCategories.length) query.category = { $in: workerCategories.map((category) => new RegExp(`^${escapeRegex(category)}$`, 'i')) };
        query.urgency = { $in: enabledJobTypes };

        const jobs = await JobPost.find(query)
            .populate('customer', 'fullName profileImage phone')
            .sort({ createdAt: -1 });

        const customerStats = await buildCustomerStatsById(jobs);
        const payload = await Promise.all(jobs.map(job => buildPersonalizedWorkerJobSignalPayload(job, customerStats, worker)));

        res.status(200).json({ success: true, data: payload });
    } catch (error: any) {
        logger.error("Error in getNearbyJobs:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get jobs posted while the worker was offline (missed jobs)
 * @route GET /api/v1/jobs/missed
 * @access Private (Worker)
 */
export const getMissedJobs = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        const worker = await Worker.findById(workerId)
            .select('category specialties location hourlyRate isActive isVerified isAvailable isInstantAvailable isScheduledAvailable lastOnlineAt');

        if (!worker) {
            return res.status(404).json({ success: false, message: "Worker not found" });
        }

        const enabledJobTypes = getEnabledJobTypesForWorker(worker);
        if (enabledJobTypes.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }

        const longitude = worker.location?.coordinates?.[0];
        const latitude = worker.location?.coordinates?.[1];

        if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
            return res.status(400).json({ success: false, message: "Worker location not set" });
        }

        // Use lastOnlineAt as the cutoff; fall back to 4 hours ago if never set
        const FALLBACK_HOURS = 4;
        const since: Date = worker.lastOnlineAt
            ? new Date(worker.lastOnlineAt)
            : new Date(Date.now() - FALLBACK_HOURS * 60 * 60 * 1000);

        // Find jobs the worker has already bid on (to exclude them)
        const existingBidJobIds = await JobBid.find({ worker: workerId })
            .distinct('jobPost');

        const query: any = {
            status: 'open',
            expiresAt: { $gt: new Date() },
            createdAt: { $gt: since },
            _id: { $nin: existingBidJobIds },
            urgency: { $in: enabledJobTypes },
            location: {
                $near: {
                    $geometry: { type: "Point", coordinates: [longitude, latitude] },
                    $maxDistance: DEFAULT_JOB_RADIUS_METERS
                }
            }
        };

        const workerCategories = await getWorkerActiveSpecialtyNames(worker);
        if (workerCategories.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }
        query.category = { $in: workerCategories.map((category) => new RegExp(`^${escapeRegex(category)}$`, 'i')) };

        const jobs = await JobPost.find(query)
            .populate('customer', 'fullName profileImage phone')
            .sort({ createdAt: -1 })
            .limit(20);

        const customerStats = await buildCustomerStatsById(jobs);
        const payload = await Promise.all(jobs.map(job => buildPersonalizedWorkerJobSignalPayload(job, customerStats, worker)));

        res.status(200).json({ success: true, data: payload });
    } catch (error: any) {
        logger.error("Error in getMissedJobs:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get Bids for a given Job Post
 * @route GET /api/v1/jobs/:jobId/bids
 */
export const getJobBids = async (req: AuthRequest, res: Response) => {
    try {
        const { jobId } = req.params;
        const bids = await JobBid.find({ jobPost: jobId })
            .populate('worker', WORKER_BID_PROFILE_SELECT)
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, data: bids });
    } catch (e) {
        res.status(500).json({ success: false });
    }
}

/**
 * @description Get bids submitted by the authenticated worker
 * @route GET /api/v1/jobs/my-bids
 * @access Private (Worker)
 */
export const getWorkerBids = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        if (!workerId || req.tokenPayload?.type !== 'worker') {
            return res.status(401).json({ success: false, message: "Unauthorized as worker" });
        }

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const skip = (page - 1) * limit;
        const statusParam = req.query.status as string | undefined;
        const allowedStatuses = ['pending', 'accepted', 'rejected'];
        const statuses = statusParam
            ? statusParam.split(',').map(s => s.trim()).filter(s => allowedStatuses.includes(s))
            : ['pending'];

        const query: any = { worker: workerId };
        if (statuses.length > 0) {
            query.status = { $in: statuses };
        }

        const bids = await JobBid.find(query)
            .populate({
                path: 'jobPost',
                select: 'customer category description urgency scheduledDate scheduledTime address location amount imageUrl imageUrls videoUrl videoUrls audioUrls status expiresAt createdAt updatedAt',
                populate: { path: 'customer', select: 'fullName profileImage phone' }
            })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const customerStats = await buildCustomerStatsById(
            bids
                .map((bid: any) => typeof bid.jobPost === 'object' ? bid.jobPost : null)
                .filter(Boolean)
        );
        const responseBids = bids.map(bid => buildWorkerBidCardPayload(bid, customerStats));
        const total = await JobBid.countDocuments(query);

        res.status(200).json({
            success: true,
            data: responseBids,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error: any) {
        logger.error("Error in getWorkerBids:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Withdraw a pending worker bid/mission interest
 * @route DELETE /api/v1/jobs/bids/:bidId
 * @access Private (Worker)
 */
export const withdrawBid = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        const { bidId } = req.params;

        if (!workerId || req.tokenPayload?.type !== 'worker') {
            return res.status(401).json({ success: false, message: "Unauthorized as worker" });
        }

        const bid = await JobBid.findById(bidId);
        if (!bid) {
            return res.status(404).json({ success: false, message: "Bid not found" });
        }

        if (bid.worker.toString() !== workerId) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }

        if (bid.status !== 'pending') {
            return res.status(400).json({ success: false, message: "Only pending bids can be withdrawn" });
        }

        const jobPost = await JobPost.findById(bid.jobPost).select('customer category status expiresAt');
        await bid.deleteOne();

        if (jobPost?.status === 'reviewing') {
            const remainingBidCount = await JobBid.countDocuments({ jobPost: jobPost._id });
            if (remainingBidCount < MAX_BIDS && jobPost.expiresAt > new Date()) {
                jobPost.status = 'open';
                await jobPost.save();
            }
        }

        const io = getIO();
        if (jobPost?.customer) {
            io.to(`user:${jobPost.customer.toString()}`).emit('bid:withdrawn', {
                bidId,
                jobId: jobPost._id,
                category: jobPost.category
            });
        }

        res.status(200).json({
            success: true,
            message: "Mission interest withdrawn successfully",
            data: { bidId, jobId: jobPost?._id }
        });
    } catch (error: any) {
        logger.error("Error in withdrawBid:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Accept an Instant Job Post
 * @route POST /api/v1/jobs/:jobId/accept-instant
 * @access Private (Worker)
 */
export const acceptInstantJob = async (req: AuthRequest, res: Response) => {
    try {
        const workerId = req.tokenPayload?.id;
        if (!workerId || req.tokenPayload?.type !== 'worker') {
            return res.status(401).json({ success: false, message: "Unauthorized as worker" });
        }

        const { jobId } = req.params;

        const jobPost = await JobPost.findById(jobId);
        if (!jobPost) return res.status(404).json({ success: false, message: "Job post not found" });

        if (jobPost.urgency !== 'instant') {
            return res.status(400).json({ success: false, message: "This API is only for instant jobs." });
        }

        if (jobPost.status !== 'open') {
            return res.status(400).json({ success: false, message: "Job is already taken or closed." });
        }

        if (jobPost.expiresAt < new Date()) {
            return res.status(400).json({ success: false, message: "This job post has expired" });
        }

        // Check if worker already bid
        const existingBid = await JobBid.findOne({ jobPost: jobId, worker: workerId });
        if (existingBid) {
            return res.status(400).json({ success: false, message: "You have already accepted this mission." });
        }

        // Create a Bid instead of assigning immediately
        const workerProfile = await Worker.findById(workerId);
        if (!workerAcceptsJobType(workerProfile, 'instant')) {
            return res.status(403).json({
                success: false,
                message: "Instant job availability is turned off. Enable it before accepting this mission."
            });
        }
        if (!await workerCanPerformCategory(workerId, jobPost.category)) {
            return res.status(403).json({ success: false, message: "This job does not match an active approved specialty on your profile." });
        }
        const proposedPrice = Number(jobPost.pricing?.clientOffer || jobPost.amount || 0);
        if (!Number.isFinite(proposedPrice) || proposedPrice <= 0) {
            return res.status(409).json({
                success: false,
                message: "This legacy job does not have a valid client offer. Ask the client to post a new request."
            });
        }
        const estimatedCommission = await calculateCommissionAmount(proposedPrice);
        const walletSettings = await getWalletSettings();
        const walletEligibility = await getWalletEligibility(workerId, estimatedCommission);
        if (!walletEligibility.isEligible) {
            return res.status(402).json({
                success: false,
                requiredBalance: walletEligibility.requiredBalance,
                currentBalance: walletEligibility.availableBalance,
                message: buildInsufficientBalanceMessage(walletEligibility.requiredBalance, walletEligibility.availableBalance)
            });
        }

        const newBid = await JobBid.create({
            jobPost: jobId,
            worker: workerId,
            message: "Instant Mission Acceptance",
            proposedPrice,
            priceMode: 'accepted_offer',
            clientOfferSnapshot: proposedPrice,
            commissionRateSnapshot: walletSettings.commissionEnabled ? walletSettings.platformFeePercentage : 0,
            status: 'pending'
        });

        // Populate worker details for the client
        await newBid.populate('worker', WORKER_BID_PROFILE_SELECT);

        const io = getIO();

        // Notify client that a worker is interested
        const roomName = `user:${jobPost.customer.toString()}`;
        logger.info(`📡 Emitting bid:new to room ${roomName} for worker ${workerProfile?.fullName}`);
        io.to(roomName).emit('bid:new', newBid);
        io.to(`worker:${workerId.toString()}`).emit('bid:submitted', { bidId: newBid._id, jobId: jobPost._id });

        res.status(200).json({
            success: true,
            data: newBid,
            message: "Mission interest registered. Waiting for client confirmation."
        });

    } catch (error: any) {
        logger.error("Error in acceptInstantJob:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Get all job posts created by the authenticated user
 * @route GET /api/v1/jobs/my-posts
 * @access Private (User)
 */
export const getMyJobPosts = async (req: AuthRequest, res: Response) => {
    try {
        const customerId = req.tokenPayload?.id;
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;

        const jobs = await JobPost.find({ customer: customerId })
            .populate('customer', 'fullName phone email profileImage')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        await Promise.all(jobs.map((job) => reconcileAssignedJobPost(job)));
        const jobsWithCardData = await buildJobPostCardPayloadsBatch(jobs);

        const total = await JobPost.countDocuments({ customer: customerId });

        res.status(200).json({
            success: true,
            data: jobsWithCardData,
            pagination: {
                total,
                page,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error: any) {
        logger.error("Error in getMyJobPosts:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Upload images for a job post
 * @route POST /api/v1/jobs/upload-images
 * @access Private (User)
 */
export const uploadJobImages = async (req: UploadRequest, res: Response) => {
    try {
        const imageUrls = req.uploadedImageUrls || [];
        const videoUrls = req.uploadedVideoUrls || [];
        const audioUrls = req.uploadedAudioUrls || [];
        if (imageUrls.length === 0 && videoUrls.length === 0 && audioUrls.length === 0) {
            return res.status(400).json({ success: false, message: "No media uploaded" });
        }
        res.status(200).json({
            success: true,
            data: {
                imageUrls,
                videoUrls,
                audioUrls
            },
            message: "Job media uploaded successfully"
        });
    } catch (error: any) {
        logger.error("Error in uploadJobImages:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * @description Cancel an open Job Post
 * @route POST /api/v1/jobs/:jobId/cancel
 * @access Private (User)
 */
export const cancelJobPost = async (req: AuthRequest, res: Response) => {
    try {
        const customerId = req.tokenPayload?.id;
        if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const { jobId } = req.params;
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

        const jobPost = await JobPost.findById(jobId);
        if (!jobPost) return res.status(404).json({ success: false, message: "Job post not found" });

        if (jobPost.customer.toString() !== customerId) {
            return res.status(403).json({ success: false, message: "Forbidden: You are not the owner of this job post." });
        }

        if (jobPost.status !== 'open' && jobPost.status !== 'reviewing') {
            return res.status(400).json({ success: false, message: `Job cannot be cancelled. Current status: ${jobPost.status}` });
        }

        // Set status to cancelled
        jobPost.status = 'cancelled';
        jobPost.cancelledBy = 'customer';
        jobPost.cancelReason = reason;
        jobPost.cancelledAt = new Date();
        await jobPost.save();

        // Reject all pending bids
        const bids = await JobBid.find({ jobPost: jobId, status: 'pending' });
        await JobBid.updateMany(
            { jobPost: jobId, status: 'pending' },
            { $set: { status: 'rejected' } }
        );

        const io = getIO();

        // Broadcast cancellation to all workers who had pending bids
        bids.forEach(bid => {
            io.to(`worker:${bid.worker.toString()}`).emit('bid:lost', { jobPost });
        });

        // Broadcast to general workers (if they are on the radar)
        io.emit('job:cancelled', { jobId: jobPost._id });

        res.status(200).json({
            success: true,
            data: jobPost,
            message: "Job post cancelled successfully."
        });

    } catch (error: any) {
        logger.error("Error in cancelJobPost:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};
