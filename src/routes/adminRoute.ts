import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import * as adminWorkerController from '../controllers/adminWorkerController';
import * as adminUserController from '../controllers/adminUserController';
import * as adminCategoryController from '../controllers/adminCategoryController';
import { adminAuthMiddleware } from '../middlewares/admin.middleware';
import validate from '../middlewares/validate.middleware';
import { loginAdminSchema } from '../validations/admin.validation';

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
router.post('/categories', adminCategoryController.createCategory);
router.patch('/categories/:id', adminCategoryController.updateCategory);
router.delete('/categories/:id', adminCategoryController.deleteCategory);

export default router;
