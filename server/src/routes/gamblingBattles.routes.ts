import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as battleController from '../controllers/gamblingBattle.controller.js';

const router = Router();

router.get('/', requireAuth, battleController.listBattles);
router.get('/history', requireAuth, battleController.listHistory);
router.get('/:id', requireAuth, battleController.getBattle);
router.post('/', requireAuth, battleController.createBattle);
router.post('/:id/join', requireAuth, battleController.joinBattle);
router.post('/:id/cancel', requireAuth, battleController.cancelBattle);

export default router;
