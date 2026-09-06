import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as motusController from '../controllers/motus.controller.js';

const router = Router();

router.get('/today', requireAuth, motusController.getToday);
router.post('/guess', requireAuth, motusController.submitGuess);

router.get('/queue', requireAuth, requireAdmin, motusController.listQueue);
router.post('/queue', requireAuth, requireAdmin, motusController.addQueueWord);
router.delete('/queue/:id', requireAuth, requireAdmin, motusController.removeQueueWord);
router.patch('/queue/:id/reorder', requireAuth, requireAdmin, motusController.reorderQueueWord);
router.get('/history', requireAuth, requireAdmin, motusController.listHistory);
router.get('/attempts', requireAuth, requireAdmin, motusController.listAttempts);
router.get('/today/admin', requireAuth, requireAdmin, motusController.getTodayAdmin);
router.put('/today', requireAuth, requireAdmin, motusController.overrideToday);

export default router;
