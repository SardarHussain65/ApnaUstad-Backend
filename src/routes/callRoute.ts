import { Router } from 'express';
import { initiateCall, getCallToken } from '../controllers/callController';
import { jwtAuthMiddleware } from '../middlewares/jwt.middleware';

const router = Router();

// Initiate an in-app voice call session (generates caller token & metadata)
router.post('/initiate', jwtAuthMiddleware, initiateCall);

// Fetch token for joining an active booking call (for recipient)
router.get('/token/:bookingId', jwtAuthMiddleware, getCallToken);

export default router;

