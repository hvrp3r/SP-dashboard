import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as rouletteController from '../controllers/roulette.controller.js';

const router = Router();

router.get('/current', requireAuth, rouletteController.getCurrent);
router.get('/payouts', requireAuth, rouletteController.getPayouts);
router.get('/history', requireAuth, rouletteController.listHistory);
router.get('/recent-numbers', requireAuth, rouletteController.listRecentNumbers);
router.post('/bet', requireAuth, rouletteController.placeBet);

export default router;
