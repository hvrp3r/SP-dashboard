import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { handleAvatarUpload } from '../middleware/upload.js';
import * as usersController from '../controllers/users.controller.js';
import * as transactionsController from '../controllers/transactions.controller.js';

const router = Router();

router.get('/me', requireAuth, usersController.getMe);
router.post('/me/claim-daily-bonus', requireAuth, usersController.claimDailyBonus);
router.get('/me/transactions', requireAuth, transactionsController.listMyTransactions);
router.post('/me/avatar', requireAuth, handleAvatarUpload, usersController.uploadAvatar);
router.post(
  '/me/leaderboard-visibility',
  requireAuth,
  requireAdmin,
  usersController.setLeaderboardVisibility
);
router.get('/:username', usersController.getPublicProfile);
router.get('/:username/stats', usersController.getStats);

export default router;
