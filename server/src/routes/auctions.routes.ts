import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as auctionsController from '../controllers/auctions.controller.js';

const router = Router();

router.get('/', requireAuth, auctionsController.listActive);
router.get('/me', requireAuth, auctionsController.getMyActivity);
router.get('/:id', requireAuth, auctionsController.getById);
router.post('/', requireAuth, auctionsController.create);
router.post('/:id/bids', requireAuth, auctionsController.placeBid);
router.delete('/:id', requireAuth, requireAdmin, auctionsController.cancel);

export default router;
