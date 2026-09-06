import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as towerController from '../controllers/tower.controller.js';

const router = Router();

router.get('/current', requireAuth, towerController.getCurrent);
router.get('/difficulties', requireAuth, towerController.getDifficulties);
router.get('/history', requireAuth, towerController.listHistory);
router.post('/start', requireAuth, towerController.start);
router.post('/pick', requireAuth, towerController.pick);
router.post('/cashout', requireAuth, towerController.cashOut);

export default router;
