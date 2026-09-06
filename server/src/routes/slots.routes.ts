import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as slotsController from '../controllers/slots.controller.js';

const router = Router();

router.get('/status', requireAuth, slotsController.getStatus);
router.get('/paytable', requireAuth, slotsController.getPaytable);
router.get('/history', requireAuth, slotsController.listHistory);
router.post('/spin', requireAuth, slotsController.spin);

export default router;
