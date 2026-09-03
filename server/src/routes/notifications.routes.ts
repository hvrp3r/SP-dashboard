import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as notificationsController from '../controllers/notifications.controller.js';

const router = Router();

router.get('/', requireAuth, notificationsController.listNotifications);
router.get('/unread-count', requireAuth, notificationsController.unreadCount);
router.post('/:id/read', requireAuth, notificationsController.markRead);
router.post('/read-all', requireAuth, notificationsController.markAllRead);

export default router;
