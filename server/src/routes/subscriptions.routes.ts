import { Router } from 'express';
import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as subscriptionsController from '../controllers/subscriptions.controller.js';

const router = Router();

// Ko-fi POSTe en application/x-www-form-urlencoded (un unique champ `data`
// contenant le JSON de l'événement) — non authentifié par JWT, vérifié via
// KOFI_VERIFICATION_TOKEN à la place (voir subscriptions.controller.ts).
router.post(
  '/kofi-webhook',
  express.urlencoded({ extended: false }),
  subscriptionsController.kofiWebhook
);

router.get('/me', requireAuth, subscriptionsController.getMine);

router.get('/admin', requireAuth, requireAdmin, subscriptionsController.listAll);
router.get('/admin/unmatched', requireAuth, requireAdmin, subscriptionsController.listUnmatched);
router.post(
  '/admin/unmatched/:eventId/match',
  requireAuth,
  requireAdmin,
  subscriptionsController.matchUnmatched
);
router.put('/admin/:userId', requireAuth, requireAdmin, subscriptionsController.adminSetStatus);

export default router;
