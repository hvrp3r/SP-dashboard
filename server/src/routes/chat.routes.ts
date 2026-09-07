import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as chatController from '../controllers/chat.controller.js';

const router = Router();

router.get('/', requireAuth, chatController.listMessages);
router.post('/', requireAuth, chatController.postMessage);

export default router;
