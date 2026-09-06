import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as crashController from '../controllers/crash.controller.js';

const router = Router();

router.get('/current', requireAuth, crashController.getCurrent);
router.get('/history', requireAuth, crashController.listHistory);
router.post('/bet', requireAuth, crashController.bet);
router.post('/cashout', requireAuth, crashController.cashOut);

export default router;
