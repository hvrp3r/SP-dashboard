import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as configController from '../controllers/config.controller.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, configController.listConfig);
router.put('/:key', requireAuth, requireAdmin, configController.updateConfig);

export default router;
