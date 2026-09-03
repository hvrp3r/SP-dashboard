import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as seasonsController from '../controllers/seasons.controller.js';

const router = Router();

router.get('/', requireAuth, seasonsController.listSeasons);
router.get('/active', requireAuth, seasonsController.getActiveSeason);
router.get('/:id/snapshot', requireAuth, seasonsController.getSnapshot);
router.post('/', requireAuth, requireAdmin, seasonsController.createSeason);
router.post('/:id/close', requireAuth, requireAdmin, seasonsController.closeSeason);

export default router;
