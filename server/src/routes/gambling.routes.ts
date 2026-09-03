import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as gamblingController from '../controllers/gambling.controller.js';

const router = Router();

router.get('/status', requireAuth, gamblingController.getStatus);
router.get('/inventory/me', requireAuth, gamblingController.listMyInventory);
router.get('/opens/me', requireAuth, gamblingController.listMyOpens);

router.get('/crates', requireAuth, gamblingController.listCrates);
router.get('/crates/:id', requireAuth, gamblingController.getCrate);
router.post('/crates', requireAuth, requireAdmin, gamblingController.createCrate);
router.put('/crates/:id', requireAuth, requireAdmin, gamblingController.updateCrate);
router.delete('/crates/:id', requireAuth, requireAdmin, gamblingController.removeCrate);
router.post('/crates/:id/open', requireAuth, gamblingController.openCrate);
router.post('/crates/:id/rewards', requireAuth, requireAdmin, gamblingController.addReward);
router.put(
  '/crates/:id/rewards/:rewardId',
  requireAuth,
  requireAdmin,
  gamblingController.updateReward
);
router.delete(
  '/crates/:id/rewards/:rewardId',
  requireAuth,
  requireAdmin,
  gamblingController.removeReward
);

export default router;
