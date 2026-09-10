import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as rouletteController from '../controllers/roulette.controller.js';

const router = Router();

router.get('/payouts', requireAuth, rouletteController.getPayouts);
router.get('/history', requireAuth, rouletteController.listHistory);
router.post('/spin', requireAuth, rouletteController.spin);

export default router;
