import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as minigamesController from '../controllers/minigames.controller.js';

const router = Router();

router.get('/', requireAuth, minigamesController.listSessions);
router.get('/:id', requireAuth, minigamesController.getSession);
router.get('/:id/questions', requireAuth, minigamesController.listQuestions);
router.post('/', requireAuth, requireAdmin, minigamesController.createSession);
router.post('/:id/join', requireAuth, minigamesController.joinSession);
router.post('/:id/participants', requireAuth, requireAdmin, minigamesController.addParticipant);
router.delete(
  '/:id/participants/:participantId',
  requireAuth,
  requireAdmin,
  minigamesController.removeParticipant
);
router.post('/:id/questions', requireAuth, requireAdmin, minigamesController.askQuestion);
router.post(
  '/:id/questions/:questionId/close',
  requireAuth,
  requireAdmin,
  minigamesController.closeQuestion
);
router.post('/:id/questions/:questionId/answer', requireAuth, minigamesController.submitAnswer);
router.post('/:id/award', requireAuth, requireAdmin, minigamesController.awardParticipants);
router.post('/:id/close', requireAuth, requireAdmin, minigamesController.closeSession);

export default router;
