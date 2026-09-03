import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as leaderboardController from '../controllers/leaderboard.controller.js';

const router = Router();

router.get('/', requireAuth, leaderboardController.getLeaderboard);

export default router;
