import express from 'express';
import { jwtAuthMiddleware } from '../middlewares/jwt.middleware';
import {
  savePushToken,
  removePushToken,
  sendNotificationToUser,
  getNotifications,
  markAsRead,
  sendBroadcastNotification,
} from '../controllers/notificationController';

const router = express.Router();

// Save push token
router.post('/save-token', jwtAuthMiddleware, savePushToken);

// Deactivate push token on logout
router.post('/remove-token', jwtAuthMiddleware, removePushToken);

// Send notification to user
router.post('/send', jwtAuthMiddleware, sendNotificationToUser);
// Broadcast / bulk send for admin
router.post('/broadcast', jwtAuthMiddleware, sendBroadcastNotification);

// Get user's notifications
router.get('/my-notifications', jwtAuthMiddleware, getNotifications);

// Mark notification as read
router.post('/mark-read', jwtAuthMiddleware, markAsRead);

export default router;