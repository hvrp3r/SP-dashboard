import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as sudokuController from '../controllers/sudoku.controller.js';

const router = Router();

router.get('/today', requireAuth, sudokuController.getToday);
router.post('/choose', requireAuth, sudokuController.chooseDifficulty);
router.post('/submit', requireAuth, sudokuController.submitCell);
router.get('/today/admin', requireAuth, requireAdmin, sudokuController.getTodayAdmin);
router.get('/attempts', requireAuth, requireAdmin, sudokuController.listAttempts);

export default router;
