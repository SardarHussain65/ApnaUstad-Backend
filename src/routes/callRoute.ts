import { Router } from 'express';
import { initiateCall, getCallToken, getActiveCallSession, endCallSession } from '../controllers/callController';
import { jwtAuthMiddleware } from '../middlewares/jwt.middleware';

const router = Router();

// Check if user has an ongoing or ringing call session (reconnect/killed state sync)
router.get('/active-session', jwtAuthMiddleware, getActiveCallSession);

// Initiate an in-app voice call session (generates caller token & metadata)
router.post('/initiate', jwtAuthMiddleware, initiateCall);

// Fetch token for joining an active booking call (for recipient)
router.get('/token/:bookingId', jwtAuthMiddleware, getCallToken);

// End or cancel an active call session
router.post('/end', jwtAuthMiddleware, endCallSession);

export default router;

