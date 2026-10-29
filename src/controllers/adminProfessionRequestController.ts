import { Response } from 'express';
import mongoose from 'mongoose';
import ProfessionRequest from '../models/ProfessionRequest';
import Category from '../models/Category';
import Workers from '../models/Workers';
import Admin from '../models/Admin';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError } from '../utils/ApiError';
import { successResponse, paginatedResponse } from '../utils/ApiResponse';
import { AdminAuthRequest } from '../middlewares/admin.middleware';
import {
    ensureLegacyPrimarySpecialty,
    getAdditionalCategoryMonthlyFee,
    FREE_SPECIALTY_LIMIT
} from '../services/workerSpecialtyService';

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Public endpoint: Submit a new profession request
 * @route POST /api/v1/workers/profession-request
 */
export const createPublicProfessionRequest = asyncHandler(async (req, res: Response) => {
    const {
        professionName,
        categoryDomain,
        requirements,
        description,
        experience,
        hourlyRate,
        skills,
        requesterName,
        requesterPhone,
        requesterEmail,
        workerId,
        certificates,
    } = req.body;

    if (!professionName || !requesterName || !requesterPhone) {
        throw new BadRequestError('Profession name, your name, and phone number are required');
    }

    const formattedCertificates = Array.isArray(certificates)
        ? certificates
              .filter((c: any) => c && c.title && c.certificateUrl)
              .map((c: any) => ({
                  title: String(c.title).trim(),
                  issuingOrg: c.issuingOrg ? String(c.issuingOrg).trim() : '',
                  issueYear: c.issueYear ? String(c.issueYear).trim() : '',
                  certificateUrl: String(c.certificateUrl).trim(),
              }))
        : [];

    const request = await ProfessionRequest.create({
        worker: workerId && mongoose.isValidObjectId(workerId) ? workerId : undefined,
        professionName: professionName.trim(),
        categoryDomain: categoryDomain ? categoryDomain.trim() : '',
        requirements: requirements ? requirements.trim() : '',
        description: description ? description.trim() : '',
        experience: Number(experience) || 0,
        hourlyRate: Number(hourlyRate) || 0,
        skills: Array.isArray(skills) ? skills : (skills ? String(skills).split(',').map(s => s.trim()).filter(Boolean) : []),
        requesterName: requesterName.trim(),
        requesterPhone: requesterPhone.trim(),
        requesterEmail: requesterEmail ? requesterEmail.trim() : '',
        certificates: formattedCertificates,
        status: 'pending',
    });

    if (workerId && mongoose.isValidObjectId(workerId) && formattedCertificates.length > 0) {
        const worker = await Workers.findById(workerId);
        if (worker) {
            const existingUrls = new Set((worker.certificates || []).map((c: any) => c.certificateUrl));
            formattedCertificates.forEach((cert) => {
                if (!existingUrls.has(cert.certificateUrl)) {
                    worker.certificates.push({
                        ...cert,
                        categoryName: professionName.trim(),
                        verificationStatus: 'pending',
                    } as any);
                }
            });
            await worker.save();
        }
    }

    return successResponse(res, 201, 'Profession request submitted successfully', request);
});

/**
 * Admin: Get all profession requests with filters and pagination
 * @route GET /api/v1/admin/profession-requests
 */
export const getAllProfessionRequests = asyncHandler(async (req: AdminAuthRequest, res: Response) => {
    const { page = '1', limit = '10', status, search } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const query: Record<string, any> = {};

    if (status && ['pending', 'approved', 'rejected'].includes(status as string)) {
        query.status = status;
    }

    if (search && typeof search === 'string') {
        const regex = new RegExp(escapeRegex(search), 'i');
        query.$or = [
            { professionName: regex },
            { requesterName: regex },
            { requesterPhone: regex },
            { description: regex },
        ];
    }

    const total = await ProfessionRequest.countDocuments(query);
    const requests = await ProfessionRequest.find(query)
        .populate('worker', 'fullName phone email profileImage category isVerified isCustomProfessionRequested')
        .populate('createdCategoryId', 'name icon color')
        .populate('reviewedBy', 'fullName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum);

    return paginatedResponse(res, 200, 'Profession requests fetched successfully', requests, pageNum, limitNum, total);
});

/**
 * Admin: Review profession request (Approve or Reject)
 * @route PATCH /api/v1/admin/profession-requests/:id/review
 */
export const reviewProfessionRequest = asyncHandler(async (req: AdminAuthRequest, res: Response) => {
    const { id } = req.params;
    const {
        status,
        rejectionReason,
        adminNotes,
        createCategory: shouldCreateCategory,
        categoryName,
        categoryIcon,
        categoryColor,
        categoryDescription,
    } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
        throw new BadRequestError("Status must be either 'approved' or 'rejected'");
    }

    const request = await ProfessionRequest.findById(id);
    if (!request) {
        throw new NotFoundError('Profession request not found');
    }

    request.status = status;
    request.adminNotes = adminNotes || request.adminNotes || '';
    request.reviewedBy = req.admin?._id;
    request.reviewedAt = new Date();

    if (status === 'rejected') {
        request.rejectionReason = rejectionReason || 'Request rejected by administrator';
        await request.save();
        return successResponse(res, 200, 'Profession request marked as rejected', request);
    }

    // Status is 'approved'
    let targetCategory = null;
    const finalCategoryName = (categoryName || request.professionName).trim();

    targetCategory = await Category.findOne({
        name: new RegExp(`^${escapeRegex(finalCategoryName)}$`, 'i'),
    });

    if (!targetCategory && shouldCreateCategory) {
        targetCategory = await Category.create({
            name: finalCategoryName,
            icon: categoryIcon || 'hammer',
            color: categoryColor || '#00F5FF',
            description: categoryDescription || request.description || '',
            isActive: true,
        });
    }

    if (targetCategory) {
        request.createdCategoryId = targetCategory._id;

        // If this request is linked to a registered worker, activate their profession!
        if (request.worker) {
            const worker = await Workers.findById(request.worker);
            if (worker) {
                await ensureLegacyPrimarySpecialty(worker);

                // Ensure specialty exists for this category
                const existingSpecialty = worker.specialties?.find(
                    (s: any) => s.categoryId?.toString() === targetCategory?._id?.toString()
                );

                if (!existingSpecialty) {
                    const hasPrimary = worker.specialties?.some((s: any) => Number(s.priority) === 1);
                    const isFree = !hasPrimary || (worker.specialties?.length || 0) < FREE_SPECIALTY_LIMIT;
                    const maxPriority = (worker.specialties || []).reduce(
                        (max: number, s: any) => Math.max(max, Number(s.priority) || 0),
                        0
                    );
                    const priority = isFree ? 1 : maxPriority + 1;
                    const additionalCategoryMonthlyFee = await getAdditionalCategoryMonthlyFee();

                    const formattedCertificates = (request.certificates || []).map((c: any) => ({
                        title: c.title || 'Certificate',
                        issuingOrg: c.issuingOrg || '',
                        issueYear: c.issueYear || '',
                        certificateUrl: c.certificateUrl,
                    }));

                    const newSpecialty: any = {
                        categoryId: targetCategory._id,
                        priority,
                        skills: request.skills?.length ? request.skills : (worker.skills || []),
                        hourlyRate: request.hourlyRate || worker.hourlyRate || 500,
                        experience: request.experience ?? worker.experience ?? 1,
                        bio: request.description || worker.bio || '',
                        certificates: formattedCertificates,
                        isActive: isFree,
                        approvalStatus: 'approved',
                        subscriptionStatus: isFree ? 'free' : 'pending_activation',
                        monthlyFeeSnapshot: isFree ? 0 : additionalCategoryMonthlyFee,
                        autoRenew: true,
                        requestedAt: request.createdAt || new Date(),
                        approvedAt: new Date(),
                        approvedBy: req.admin?._id,
                    };

                    if (isFree) {
                        worker.category = targetCategory.name;
                    }

                    worker.specialties.push(newSpecialty);

                    if (formattedCertificates.length > 0) {
                        const existingUrls = new Set((worker.certificates || []).map((c: any) => c.certificateUrl));
                        formattedCertificates.forEach((cert: any) => {
                            if (!existingUrls.has(cert.certificateUrl)) {
                                worker.certificates.push({
                                    ...cert,
                                    categoryName: targetCategory.name,
                                    verificationStatus: 'verified',
                                    verifiedAt: new Date(),
                                    verifiedBy: req.admin?._id,
                                } as any);
                            }
                        });
                    }
                } else {
                    existingSpecialty.approvalStatus = 'approved';
                    existingSpecialty.approvedAt = new Date();
                    existingSpecialty.approvedBy = req.admin?._id;
                }

                worker.isCustomProfessionRequested = false;
                await worker.save();
            }
        }
    }

    await request.save();

    return successResponse(res, 200, 'Profession request approved successfully', request);
});

/**
 * Worker: Delete / cancel own profession request
 * @route DELETE /api/v1/workers/profession-request/:id
 */
export const deleteWorkerProfessionRequest = asyncHandler(async (req: any, res: Response) => {
    const { id } = req.params;
    const workerId = req.tokenPayload?.id;
    if (!workerId) throw new BadRequestError('Worker identity required');

    const request = await ProfessionRequest.findOne({ _id: id, worker: workerId });
    if (!request) throw new NotFoundError('Profession request not found');

    await ProfessionRequest.findByIdAndDelete(id);
    return successResponse(res, 200, 'Profession request removed successfully');
});
