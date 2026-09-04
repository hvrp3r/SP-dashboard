import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as blackjackController from '../controllers/blackjack.controller.js';

const router = Router();

router.get('/current', requireAuth, blackjackController.getCurrent);
router.get('/history/me', requireAuth, blackjackController.listMyHistory);
router.post('/join', requireAuth, blackjackController.join);
router.post('/hit', requireAuth, blackjackController.hit);
router.post('/stand', requireAuth, blackjackController.stand);

export default router;
