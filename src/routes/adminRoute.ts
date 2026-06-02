import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import * as adminWorkerController from '../controllers/adminWorkerController';
import * as adminUserController from '../controllers/adminUserController';
import * as adminCategoryController from '../controllers/adminCategoryController';
import * as adminJobController from '../controllers/adminJobController';
import * as adminBookingController from '../controllers/adminBookingController';
import * as adminReviewController from '../controllers/adminReviewController';
import * as adminNotificationController from '../controllers/adminNotificationController';
import * as adminPaymentController from '../controllers/adminPaymentController';
import * as adminWalletController from '../controllers/adminWalletController';
import * as adminWalletTopUpController from '../controllers/adminWalletTopUpController';
import * as adminWalletPaymentMethodController from '../controllers/adminWalletPaymentMethodController';
import * as adminSupportController from '../controllers/supportController';
import * as adminReportController from '../controllers/adminReportController';
import * as adminAuditController from '../controllers/adminAuditController';
import * as adminDisputeController from '../controllers/disputeController';
import * as adminPromoController from '../controllers/promoController';
import * as adminVerificationController from '../controllers/adminVerificationController';
import { adminAuthMiddleware, isSuperAdmin } from '../middlewares/admin.middleware';
import validate from '../middlewares/validate.middleware';
import { loginAdminSchema } from '../validations/admin.validation';
import { createCategorySchema, updateCategorySchema } from '../validations/category.validation';
import { authLimiter } from '../middlewares/rateLimiter';

const router = Router();

/**
 * Public Admin Routes
 */
router.post('/login', authLimiter, validate(loginAdminSchema), adminController.loginAdmin);

/**
 * Protected Admin Routes
 */
router.use(adminAuthMiddleware);

router.get('/me', adminController.getAdminProfile);
router.patch('/me', adminController.updateAdminProfile);
router.post('/change-password', adminController.changeAdminPassword);
router.get('/dashboard/stats', adminController.getDashboardStats);

/**
 * User Management
 */
router.get('/users', adminUserController.getAllUsers);
router.get('/users/:id', adminUserController.getUserDetails);
router.patch('/users/:id/status', adminUserController.toggleUserStatus);

/**
 * Worker Management
 */
router.get('/workers', adminWorkerController.getAllWorkers);
router.get('/workers/:id', adminWorkerController.getWorkerDetails);
router.patch('/workers/:id/verify', adminWorkerController.verifyWorker);
router.patch('/workers/:id/status', adminWorkerController.toggleWorkerStatus);
router.patch('/workers/:id', adminWorkerController.updateWorkerProfile);

/**
 * Worker Identity Verification Pipeline
 */
router.get('/verification/requests', adminVerificationController.getVerificationRequests);
router.patch('/verification/requests/:id/review', adminVerificationController.reviewVerificationRequest);

/**
 * Category Management
 */
router.get('/categories', adminCategoryController.getAllCategories);
router.post('/categories', validate(createCategorySchema), adminCategoryController.createCategory);
router.patch('/categories/:id', validate(updateCategorySchema), adminCategoryController.updateCategory);
router.delete('/categories/:id', adminCategoryController.deleteCategory);

/**
 * Job Management
 */
router.get('/jobs', adminJobController.getAllJobs);
router.get('/jobs/:id', adminJobController.getJobDetails);
router.patch('/jobs/:id/status', adminJobController.updateJobStatus);
router.patch('/jobs/:id/cancel', adminJobController.cancelJob);
router.delete('/jobs/:id', adminJobController.deleteJob);

/**
 * Booking Management
 */
router.get('/bookings', adminBookingController.getAllBookings);
router.get('/bookings/:id', adminBookingController.getBookingDetails);
router.patch('/bookings/:id/status', adminBookingController.updateBookingStatus);
router.post('/bookings/:id/cancel', adminBookingController.cancelBooking);

/**
 * Payment Ledger
 */
router.get('/payments', adminPaymentController.getAllPayments);
router.get('/payments/summary', adminPaymentController.getPaymentSummary);

/**
 * Review Management
 */
router.get('/reviews', adminReviewController.getAllReviews);
router.patch('/reviews/:id/flag', adminReviewController.toggleFlagReview);
router.delete('/reviews/:id', adminReviewController.deleteReview);

/**
 * Notification Management
 */
router.post('/notifications/global', adminNotificationController.sendGlobalNotification);
router.get('/notifications', adminNotificationController.getAdminNotifications);

/**
 * Support Management
 */
router.get('/support/requests', adminSupportController.listSupportRequests);
router.get('/support/requests/:id', adminSupportController.getSupportRequest);
router.post('/support/requests/:id/reply', adminSupportController.replyToSupportRequest);
router.patch('/support/requests/:id/status', adminSupportController.updateSupportStatus);
router.patch('/support/requests/:id/priority', adminSupportController.updateSupportPriority);

/**
 * Wallet Management
 */
router.get('/wallets', adminWalletController.getAllWorkerWallets);
router.get('/wallets/summary', adminWalletController.getWalletSummary);
router.get('/wallet-settings', adminWalletController.getWalletSettingsController);
router.patch('/wallet-settings', adminWalletController.updateWalletSettingsController);
router.get('/wallets/:workerId', adminWalletController.getWorkerWalletDetails);
router.post('/wallets/:workerId/recharge', adminWalletController.rechargeWorkerWallet);
router.post('/wallets/:workerId/adjust', adminWalletController.adjustWorkerWallet);
router.get('/wallet-payment-methods', adminWalletPaymentMethodController.getWalletPaymentMethods);
router.patch('/wallet-payment-methods', adminWalletPaymentMethodController.updateWalletPaymentMethods);

/**
 * Wallet Top-Up Verification
 */
router.get('/wallet-topups/summary', adminWalletTopUpController.getWalletTopUpSummary);
router.get('/wallet-topups', adminWalletTopUpController.getAllWalletTopUps);
router.get('/wallet-topups/:id', adminWalletTopUpController.getWalletTopUpDetails);
router.patch('/wallet-topups/:id/approve', adminWalletTopUpController.approveWalletTopUp);
router.patch('/wallet-topups/:id/reject', adminWalletTopUpController.rejectWalletTopUp);

/**
 * Dispute Resolution
 */
router.get('/disputes', adminDisputeController.getAllDisputes);
router.get('/disputes/:id', adminDisputeController.getDisputeDetails);
router.patch('/disputes/:id/resolve', adminDisputeController.resolveDispute);

/**
 * Promo & Coupon Management
 */
router.get('/promos', adminPromoController.getAllPromoCodes);
router.post('/promos', adminPromoController.createPromoCode);
router.patch('/promos/:id/status', adminPromoController.togglePromoCode);
router.delete('/promos/:id', adminPromoController.deletePromoCode);

/**
 * Reports & Analytics
 */
router.get('/reports/revenue', adminReportController.getRevenueReport);
router.get('/reports/bookings', adminReportController.getBookingsReport);
router.get('/reports/workers', adminReportController.getWorkersReport);
router.get('/reports/users', adminReportController.getUsersReport);

/**
 * Audit Logs
 */
router.get('/audit-logs', adminAuditController.getAuditLogs);

/**
 * Sub-Admin Management (requires superadmin role)
 */
router.get('/admins', isSuperAdmin, adminController.getAllAdmins);
router.post('/admins', isSuperAdmin, adminController.createAdmin);
router.patch('/admins/:id/status', isSuperAdmin, adminController.toggleAdminStatus);
router.delete('/admins/:id', isSuperAdmin, adminController.deleteAdmin);

export default router;
