import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as challengesController from '../controllers/challenges.controller.js';

const router = Router();

router.get('/status', requireAuth, challengesController.getStatus);
router.get('/', requireAuth, challengesController.listMyChallenges);
router.get('/admin', requireAuth, requireAdmin, challengesController.listAllChallenges);
router.post('/', requireAuth, challengesController.createChallenge);
router.post('/:id/accept', requireAuth, challengesController.acceptChallenge);
router.post('/:id/decline', requireAuth, challengesController.declineChallenge);
router.post('/:id/report', requireAuth, challengesController.reportResult);
router.post('/:id/arbitrate', requireAuth, requireAdmin, challengesController.arbitrateChallenge);
router.post('/:id/cancel', requireAuth, requireAdmin, challengesController.cancelChallenge);

export default router;
