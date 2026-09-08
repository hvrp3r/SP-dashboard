import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { handleTeamLogoUpload } from '../middleware/upload.js';
import * as eventsController from '../controllers/events.controller.js';
import * as flappybirdController from '../controllers/flappybird.controller.js';
import * as speedrunController from '../controllers/speedrun.controller.js';
import * as tournamentsController from '../controllers/tournaments.controller.js';

const router = Router();

router.get('/', requireAuth, eventsController.listSessions);
router.get('/:id', requireAuth, eventsController.getSession);
router.get('/:id/questions', requireAuth, eventsController.listQuestions);
router.post('/', requireAuth, requireAdmin, eventsController.createSession);
router.post('/:id/join', requireAuth, eventsController.joinSession);
router.post('/:id/participants', requireAuth, requireAdmin, eventsController.addParticipant);
router.delete(
  '/:id/participants/:participantId',
  requireAuth,
  requireAdmin,
  eventsController.removeParticipant
);
router.post('/:id/questions', requireAuth, requireAdmin, eventsController.askQuestion);
router.post(
  '/:id/questions/:questionId/close',
  requireAuth,
  requireAdmin,
  eventsController.closeQuestion
);
router.post('/:id/questions/:questionId/answer', requireAuth, eventsController.submitAnswer);
router.post(
  '/:id/questions/:questionId/answers/:userId/grade',
  requireAuth,
  requireAdmin,
  eventsController.gradeAnswer
);
router.post('/:id/award', requireAuth, requireAdmin, eventsController.awardParticipants);
router.post('/:id/close', requireAuth, requireAdmin, eventsController.closeSession);

router.post('/:id/flappybird/attempts/start', requireAuth, flappybirdController.startAttempt);
router.post('/:id/flappybird/attempts/point', requireAuth, flappybirdController.reportPoint);
router.post('/:id/flappybird/attempts', requireAuth, flappybirdController.submitScore);
router.put('/:id/flappybird/rewards', requireAuth, requireAdmin, flappybirdController.updateRewards);
router.post(
  '/:id/flappybird/attempts/:attemptId/exclude',
  requireAuth,
  requireAdmin,
  flappybirdController.excludeAttempt
);
router.post(
  '/:id/flappybird/close-and-distribute',
  requireAuth,
  requireAdmin,
  flappybirdController.closeAndDistribute
);
router.post('/:id/flappybird/cancel', requireAuth, requireAdmin, flappybirdController.cancelSession);

router.get(
  '/speedrun/search-games',
  requireAuth,
  requireAdmin,
  speedrunController.searchGames
);
router.post('/:id/speedrun/attempts', requireAuth, speedrunController.submitAttempt);
router.put('/:id/speedrun/rewards', requireAuth, requireAdmin, speedrunController.updateRewards);
router.post(
  '/:id/speedrun/attempts/:attemptId/exclude',
  requireAuth,
  requireAdmin,
  speedrunController.excludeAttempt
);
router.post(
  '/:id/speedrun/close-and-distribute',
  requireAuth,
  requireAdmin,
  speedrunController.closeAndDistribute
);
router.post('/:id/speedrun/cancel', requireAuth, requireAdmin, speedrunController.cancelSession);

// --- Tournois (game_type 'tournament') — inscription via /join générique ---
router.post(
  '/:id/tournament/teams',
  requireAuth,
  requireAdmin,
  handleTeamLogoUpload,
  tournamentsController.createTeam
);
router.put(
  '/:id/tournament/teams/:teamId',
  requireAuth,
  requireAdmin,
  handleTeamLogoUpload,
  tournamentsController.updateTeam
);
router.delete(
  '/:id/tournament/teams/:teamId',
  requireAuth,
  requireAdmin,
  tournamentsController.deleteTeam
);
router.post(
  '/:id/tournament/teams/:teamId/members',
  requireAuth,
  requireAdmin,
  tournamentsController.addTeamMember
);
router.delete(
  '/:id/tournament/teams/:teamId/members/:userId',
  requireAuth,
  requireAdmin,
  tournamentsController.removeTeamMember
);
router.put(
  '/:id/tournament/participants/:userId/rating',
  requireAuth,
  requireAdmin,
  tournamentsController.setParticipantRating
);
router.post(
  '/:id/tournament/auto-teams',
  requireAuth,
  requireAdmin,
  tournamentsController.autoGenerateTeams
);
router.post('/:id/tournament/bracket', requireAuth, requireAdmin, tournamentsController.generateBracket);
router.delete('/:id/tournament/bracket', requireAuth, requireAdmin, tournamentsController.resetBracket);
router.post(
  '/:id/tournament/matches/:matchId/winner',
  requireAuth,
  requireAdmin,
  tournamentsController.resolveMatch
);
router.post(
  '/:id/tournament/announcements',
  requireAuth,
  requireAdmin,
  tournamentsController.createAnnouncement
);

export default router;
