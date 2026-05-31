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
import { adminAuthMiddleware } from '../middlewares/admin.middleware';
import validate from '../middlewares/validate.middleware';
import { loginAdminSchema } from '../validations/admin.validation';
import { createCategorySchema, updateCategorySchema } from '../validations/category.validation';

const router = Router();

/**
 * Public Admin Routes
 */
router.post('/login', validate(loginAdminSchema), adminController.loginAdmin);

/**
 * Protected Admin Routes
 */
router.use(adminAuthMiddleware);

router.get('/me', adminController.getAdminProfile);
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
router.delete('/jobs/:id', adminJobController.deleteJob);

/**
 * Booking Management
 */
router.get('/bookings', adminBookingController.getAllBookings);
router.get('/bookings/:id', adminBookingController.getBookingDetails);

/**
 * Payment Ledger
 */
router.get('/payments', adminPaymentController.getAllPayments);
router.get('/payments/summary', adminPaymentController.getPaymentSummary);

/**
 * Review Management
 */
router.get('/reviews', adminReviewController.getAllReviews);
router.delete('/reviews/:id', adminReviewController.deleteReview);

/**
 * Notification Management
 */
router.post('/notifications/global', adminNotificationController.sendGlobalNotification);
router.get('/notifications', adminNotificationController.getAdminNotifications);

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

export default router;
