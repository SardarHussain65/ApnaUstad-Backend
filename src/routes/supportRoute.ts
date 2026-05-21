import { Router } from 'express';
import { getHelpTopics, getHelpArticles, searchHelpArticles, getSupportChannels, createSupportRequest, listSupportRequests, getSupportRequest, getSupportRequestsByUser, replyToSupportRequest } from '../controllers/supportController';

const router = Router();

router.get('/topics', getHelpTopics);
router.get('/articles', getHelpArticles);
router.get('/search', searchHelpArticles);
router.get('/channels', getSupportChannels);
router.post('/requests', createSupportRequest);
router.get('/requests', listSupportRequests);
router.get('/requests/:id', getSupportRequest);
router.get('/requests/user/:userId', getSupportRequestsByUser);
router.post('/requests/:id/reply', replyToSupportRequest);

export default router;
