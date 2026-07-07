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
import * as adminPlatformController from '../controllers/adminPlatformController';
import * as workerSpecialtyController from '../controllers/workerSpecialtyController';
import { adminAuthMiddleware, isSuperAdmin, requirePermission } from '../middlewares/admin.middleware';
import validate from '../middlewares/validate.middleware';
import { loginAdminSchema } from '../validations/admin.validation';
import { createCategorySchema, updateCategorySchema } from '../validations/category.validation';
import { authLimiter } from '../middlewares/rateLimiter';

const router = Router();

router.post('/login', authLimiter, validate(loginAdminSchema), adminController.loginAdmin);

router.use(adminAuthMiddleware);

router.get('/me', adminController.getAdminProfile);
router.patch('/me', adminController.updateAdminProfile);
router.post('/change-password', adminController.changeAdminPassword);
router.get('/meta/cities', requirePermission('users', 'workers', 'jobs', 'bookings'), adminController.getAdminMetaCities);
router.get('/dashboard/stats', requirePermission('dashboard'), adminController.getDashboardStats);

router.get('/users', requirePermission('users'), adminUserController.getAllUsers);
router.get('/users/:id', requirePermission('users'), adminUserController.getUserDetails);
router.patch('/users/:id/status', requirePermission('users'), adminUserController.toggleUserStatus);

router.get('/workers/onboarding', requirePermission('onboarding', 'workers'), adminWorkerController.getWorkerOnboardingQueue);
router.get('/workers', requirePermission('workers'), adminWorkerController.getAllWorkers);
router.get('/workers/:id', requirePermission('workers'), adminWorkerController.getWorkerDetails);
router.patch('/workers/:id/verify', requirePermission('verification', 'workers'), adminWorkerController.verifyWorker);
router.patch('/workers/:id/status', requirePermission('workers'), adminWorkerController.toggleWorkerStatus);
router.patch('/workers/:id', requirePermission('workers'), adminWorkerController.updateWorkerProfile);
router.get('/specialty-requests', requirePermission('specialty-requests', 'workers'), workerSpecialtyController.getPendingSpecialtyRequests);
router.patch('/workers/:workerId/specialties/:categoryId/review', requirePermission('specialty-requests', 'workers'), workerSpecialtyController.reviewSpecialtyRequest);

router.get('/verification/requests', requirePermission('verification'), adminVerificationController.getVerificationRequests);
router.patch('/verification/requests/:id/review', requirePermission('verification'), adminVerificationController.reviewVerificationRequest);

router.get('/categories', requirePermission('categories'), adminCategoryController.getAllCategories);
router.post('/categories', requirePermission('categories'), validate(createCategorySchema), adminCategoryController.createCategory);
router.patch('/categories/:id', requirePermission('categories'), validate(updateCategorySchema), adminCategoryController.updateCategory);
router.delete('/categories/:id', requirePermission('categories'), adminCategoryController.deleteCategory);

router.get('/jobs', requirePermission('jobs'), adminJobController.getAllJobs);
router.get('/jobs/:id', requirePermission('jobs'), adminJobController.getJobDetails);
router.patch('/jobs/:id/status', requirePermission('jobs'), adminJobController.updateJobStatus);
router.patch('/jobs/:id/cancel', requirePermission('jobs'), adminJobController.cancelJob);
router.delete('/jobs/:id', requirePermission('jobs'), adminJobController.deleteJob);

router.get('/bookings', requirePermission('bookings'), adminBookingController.getAllBookings);
router.get('/bookings/:id', requirePermission('bookings'), adminBookingController.getBookingDetails);
router.get('/bookings/:id/messages', requirePermission('bookings', 'disputes', 'support'), adminBookingController.getAdminBookingMessages);
router.patch('/bookings/:id/status', requirePermission('bookings'), adminBookingController.updateBookingStatus);
router.post('/bookings/:id/cancel', requirePermission('bookings'), adminBookingController.cancelBooking);

router.get('/payments', requirePermission('payments'), adminPaymentController.getAllPayments);
router.get('/payments/summary', requirePermission('payments'), adminPaymentController.getPaymentSummary);

router.get('/reviews', requirePermission('reviews'), adminReviewController.getAllReviews);
router.patch('/reviews/:id/flag', requirePermission('reviews'), adminReviewController.toggleFlagReview);
router.delete('/reviews/:id', requirePermission('reviews'), adminReviewController.deleteReview);

router.post('/notifications/global', requirePermission('notifications'), adminNotificationController.sendGlobalNotification);
router.get('/notifications', requirePermission('notifications'), adminNotificationController.getAdminNotifications);

router.get('/support/requests', requirePermission('support'), adminSupportController.listSupportRequests);
router.get('/support/requests/:id', requirePermission('support'), adminSupportController.getSupportRequest);
router.post('/support/requests/:id/reply', requirePermission('support'), adminSupportController.replyToSupportRequest);
router.patch('/support/requests/:id/status', requirePermission('support'), adminSupportController.updateSupportStatus);
router.patch('/support/requests/:id/priority', requirePermission('support'), adminSupportController.updateSupportPriority);

router.get('/wallets', requirePermission('wallets'), adminWalletController.getAllWorkerWallets);
router.get('/wallets/summary', requirePermission('wallets'), adminWalletController.getWalletSummary);
router.get('/wallet-settings', requirePermission('wallets', 'platform-config'), adminWalletController.getWalletSettingsController);
router.patch('/wallet-settings', requirePermission('platform-config'), adminWalletController.updateWalletSettingsController);
router.get('/wallets/:workerId', requirePermission('wallets'), adminWalletController.getWorkerWalletDetails);
router.post('/wallets/:workerId/recharge', requirePermission('wallets'), adminWalletController.rechargeWorkerWallet);
router.post('/wallets/:workerId/adjust', requirePermission('wallets'), adminWalletController.adjustWorkerWallet);
router.get('/wallet-payment-methods', requirePermission('wallets', 'platform-config'), adminWalletPaymentMethodController.getWalletPaymentMethods);
router.patch('/wallet-payment-methods', requirePermission('platform-config'), adminWalletPaymentMethodController.updateWalletPaymentMethods);

router.get('/wallet-topups/summary', requirePermission('wallets'), adminWalletTopUpController.getWalletTopUpSummary);
router.get('/wallet-topups', requirePermission('wallets'), adminWalletTopUpController.getAllWalletTopUps);
router.get('/wallet-topups/:id', requirePermission('wallets'), adminWalletTopUpController.getWalletTopUpDetails);
router.patch('/wallet-topups/:id/approve', requirePermission('wallets'), adminWalletTopUpController.approveWalletTopUp);
router.patch('/wallet-topups/:id/reject', requirePermission('wallets'), adminWalletTopUpController.rejectWalletTopUp);

router.get('/disputes', requirePermission('disputes'), adminDisputeController.getAllDisputes);
router.get('/disputes/:id', requirePermission('disputes'), adminDisputeController.getDisputeDetails);
router.patch('/disputes/:id/resolve', requirePermission('disputes'), adminDisputeController.resolveDispute);

router.get('/promos', requirePermission('promos'), adminPromoController.getAllPromoCodes);
router.post('/promos', requirePermission('promos'), adminPromoController.createPromoCode);
router.patch('/promos/:id/status', requirePermission('promos'), adminPromoController.togglePromoCode);
router.delete('/promos/:id', requirePermission('promos'), adminPromoController.deletePromoCode);

router.get('/reports/revenue', requirePermission('reports'), adminReportController.getRevenueReport);
router.get('/reports/bookings', requirePermission('reports'), adminReportController.getBookingsReport);
router.get('/reports/workers', requirePermission('reports'), adminReportController.getWorkersReport);
router.get('/reports/users', requirePermission('reports'), adminReportController.getUsersReport);

router.get('/audit-logs', requirePermission('audit'), adminAuditController.getAuditLogs);

router.get('/platform-settings', requirePermission('platform-config'), adminPlatformController.getPlatformSettingsController);
router.patch('/platform-settings', requirePermission('platform-config'), adminPlatformController.updatePlatformSettingsController);

router.get('/admins', isSuperAdmin, adminController.getAllAdmins);
router.post('/admins', isSuperAdmin, adminController.createAdmin);
router.patch('/admins/:id/status', isSuperAdmin, adminController.toggleAdminStatus);
router.delete('/admins/:id', isSuperAdmin, adminController.deleteAdmin);

export default router;
