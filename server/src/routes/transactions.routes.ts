import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as transactionsController from '../controllers/transactions.controller.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, transactionsController.listAllTransactions);
router.post('/', requireAuth, requireAdmin, transactionsController.createTransaction);
router.post('/:id/revoke', requireAuth, requireAdmin, transactionsController.revokeTransaction);

export default router;
