import { Router } from 'express';
import { jwtAuthMiddleware } from '../middlewares/jwt.middleware';
import { getMyPreferences, updateMyPreferences } from '../controllers/preferencesController';

const router = Router();

router.get('/my', jwtAuthMiddleware, getMyPreferences);
router.put('/my', jwtAuthMiddleware, updateMyPreferences);

export default router;
