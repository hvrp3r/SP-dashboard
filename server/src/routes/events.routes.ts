import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventOrganizer, requireSessionManager } from '../middleware/eventPermissions.js';
import { handleTeamLogoUpload } from '../middleware/upload.js';
import * as eventsController from '../controllers/events.controller.js';
import * as flappybirdController from '../controllers/flappybird.controller.js';
import * as speedrunController from '../controllers/speedrun.controller.js';
import * as tournamentsController from '../controllers/tournaments.controller.js';

const router = Router();

router.get('/', requireAuth, eventsController.listSessions);
router.get('/:id', requireAuth, eventsController.getSession);
router.get('/:id/questions', requireAuth, eventsController.listQuestions);
router.post('/', requireAuth, requireEventOrganizer, eventsController.createSession);
router.post('/:id/join', requireAuth, eventsController.joinSession);
router.post('/:id/participants', requireAuth, requireSessionManager, eventsController.addParticipant);
router.delete(
  '/:id/participants/:participantId',
  requireAuth,
  requireSessionManager,
  eventsController.removeParticipant
);
router.post('/:id/questions', requireAuth, requireSessionManager, eventsController.askQuestion);
router.post(
  '/:id/questions/:questionId/close',
  requireAuth,
  requireSessionManager,
  eventsController.closeQuestion
);
router.post('/:id/questions/:questionId/answer', requireAuth, eventsController.submitAnswer);
router.post(
  '/:id/questions/:questionId/answers/:userId/grade',
  requireAuth,
  requireSessionManager,
  eventsController.gradeAnswer
);
// Attribution libre de SP : MSP uniquement, même sur la session d'un organisateur
router.post('/:id/award', requireAuth, requireAdmin, eventsController.awardParticipants);
router.post('/:id/close', requireAuth, requireSessionManager, eventsController.closeSession);

router.post('/:id/flappybird/attempts/start', requireAuth, flappybirdController.startAttempt);
router.post('/:id/flappybird/attempts/point', requireAuth, flappybirdController.reportPoint);
router.post('/:id/flappybird/attempts', requireAuth, flappybirdController.submitScore);
router.put('/:id/flappybird/rewards', requireAuth, requireSessionManager, flappybirdController.updateRewards);
router.post(
  '/:id/flappybird/attempts/:attemptId/exclude',
  requireAuth,
  requireSessionManager,
  flappybirdController.excludeAttempt
);
router.post(
  '/:id/flappybird/close-and-distribute',
  requireAuth,
  requireSessionManager,
  flappybirdController.closeAndDistribute
);
router.post('/:id/flappybird/cancel', requireAuth, requireSessionManager, flappybirdController.cancelSession);

router.get(
  '/speedrun/search-games',
  requireAuth,
  requireEventOrganizer,
  speedrunController.searchGames
);
router.post('/:id/speedrun/attempts', requireAuth, speedrunController.submitAttempt);
router.put('/:id/speedrun/rewards', requireAuth, requireSessionManager, speedrunController.updateRewards);
router.post(
  '/:id/speedrun/attempts/:attemptId/exclude',
  requireAuth,
  requireSessionManager,
  speedrunController.excludeAttempt
);
router.post(
  '/:id/speedrun/close-and-distribute',
  requireAuth,
  requireSessionManager,
  speedrunController.closeAndDistribute
);
router.post('/:id/speedrun/cancel', requireAuth, requireSessionManager, speedrunController.cancelSession);

// --- Tournois (game_type 'tournament') — inscription via /join générique ---
router.post(
  '/:id/tournament/teams',
  requireAuth,
  requireSessionManager,
  handleTeamLogoUpload,
  tournamentsController.createTeam
);
router.put(
  '/:id/tournament/teams/:teamId',
  requireAuth,
  requireSessionManager,
  handleTeamLogoUpload,
  tournamentsController.updateTeam
);
router.delete(
  '/:id/tournament/teams/:teamId',
  requireAuth,
  requireSessionManager,
  tournamentsController.deleteTeam
);
router.post(
  '/:id/tournament/teams/:teamId/members',
  requireAuth,
  requireSessionManager,
  tournamentsController.addTeamMember
);
router.delete(
  '/:id/tournament/teams/:teamId/members/:userId',
  requireAuth,
  requireSessionManager,
  tournamentsController.removeTeamMember
);
router.put(
  '/:id/tournament/participants/:userId/rating',
  requireAuth,
  requireSessionManager,
  tournamentsController.setParticipantRating
);
router.post(
  '/:id/tournament/auto-teams',
  requireAuth,
  requireSessionManager,
  tournamentsController.autoGenerateTeams
);
router.post('/:id/tournament/bracket', requireAuth, requireSessionManager, tournamentsController.generateBracket);
router.delete('/:id/tournament/bracket', requireAuth, requireSessionManager, tournamentsController.resetBracket);
router.post(
  '/:id/tournament/matches/:matchId/winner',
  requireAuth,
  requireSessionManager,
  tournamentsController.resolveMatch
);
router.post(
  '/:id/tournament/announcements',
  requireAuth,
  requireSessionManager,
  tournamentsController.createAnnouncement
);

export default router;
