import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as suggestionsController from '../controllers/suggestions.controller.js';

const router = Router();

router.get('/', requireAuth, suggestionsController.listSuggestions);
router.post('/', requireAuth, suggestionsController.createSuggestion);
router.get('/:id', requireAuth, suggestionsController.getSuggestion);
router.post('/:id/vote', requireAuth, suggestionsController.castVote);
router.post('/:id/comments', requireAuth, suggestionsController.addComment);
router.post('/:id/close', requireAuth, requireAdmin, suggestionsController.closeSuggestion);
router.delete('/:id', requireAuth, requireAdmin, suggestionsController.deleteSuggestion);

export default router;
