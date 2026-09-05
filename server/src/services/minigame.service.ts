import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as cosmeticsService from './cosmetics.service.js';
import type {
  MinigameAnswerRow,
  MinigameParticipantEntry,
  MinigameParticipantRow,
  MinigameQuestionRow,
  MinigameSessionRow,
  MinigameStatus,
} from '../types.js';

interface CreateSessionInput {
  seasonId: number | null;
  gameType: string;
  title: string;
  description: string | null;
  entryFee: number | null;
  createdBy: number;
  endsAt?: string | null;
  reward1st?: number | null;
  reward2nd?: number | null;
  reward3rd?: number | null;
}

export async function createSession({
  seasonId,
  gameType,
  title,
  description,
  entryFee,
  createdBy,
  endsAt = null,
  reward1st = null,
  reward2nd = null,
  reward3rd = null,
}: CreateSessionInput): Promise<MinigameSessionRow> {
  const { rows } = await pool.query<MinigameSessionRow>(
    `INSERT INTO minigame_sessions
       (season_id, game_type, title, description, entry_fee, status, created_by,
        ends_at, reward_1st, reward_2nd, reward_3rd)
     VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10)
     RETURNING *`,
    [seasonId, gameType, title, description, entryFee, createdBy, endsAt, reward1st, reward2nd, reward3rd]
  );
  return rows[0] as MinigameSessionRow;
}

export async function listSessions(status?: MinigameStatus): Promise<MinigameSessionRow[]> {
  if (status) {
    const { rows } = await pool.query<MinigameSessionRow>(
      'SELECT * FROM minigame_sessions WHERE status = $1 ORDER BY created_at DESC',
      [status]
    );
    return rows;
  }
  const { rows } = await pool.query<MinigameSessionRow>(
    'SELECT * FROM minigame_sessions ORDER BY created_at DESC'
  );
  return rows;
}

export async function getSessionById(id: number): Promise<MinigameSessionRow | null> {
  const { rows } = await pool.query<MinigameSessionRow>(
    'SELECT * FROM minigame_sessions WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function getSessionParticipants(
  sessionId: number
): Promise<MinigameParticipantEntry[]> {
  const { rows } = await pool.query<Omit<MinigameParticipantEntry, 'equipped_cosmetics'>>(
    `SELECT p.*, u.username, u.avatar_url
     FROM minigame_participants p
     JOIN users u ON u.id = p.user_id
     WHERE p.session_id = $1
     ORDER BY p.joined_at ASC`,
    [sessionId]
  );
  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));
  return rows.map((row) => ({
    ...row,
    equipped_cosmetics: equippedByUser.get(row.user_id) ?? [],
  }));
}

export async function getParticipantByUser(
  sessionId: number,
  userId: number
): Promise<MinigameParticipantRow | null> {
  const { rows } = await pool.query<MinigameParticipantRow>(
    'SELECT * FROM minigame_participants WHERE session_id = $1 AND user_id = $2',
    [sessionId, userId]
  );
  return rows[0] ?? null;
}

export async function addParticipant(
  sessionId: number,
  userId: number
): Promise<MinigameParticipantRow> {
  const existing = await getParticipantByUser(sessionId, userId);
  if (existing) {
    throw Object.assign(new Error('Ce joueur participe déjà à cette session'), { status: 409 });
  }

  const { rows } = await pool.query<MinigameParticipantRow>(
    `INSERT INTO minigame_participants (session_id, user_id)
     VALUES ($1, $2)
     RETURNING *`,
    [sessionId, userId]
  );
  return rows[0] as MinigameParticipantRow;
}

/**
 * Auto-inscription d'un joueur. Si la session est payante (`entry_fee`), le
 * débit et l'inscription sont composés dans une seule transaction — un solde
 * insuffisant fait échouer l'inscription sans débiter personne. L'ajout
 * manuel d'un participant par le MSP (`addParticipant`) ne passe pas par ce
 * droit d'entrée.
 */
export async function joinSession(
  sessionId: number,
  userId: number
): Promise<MinigameParticipantRow> {
  const session = await getSessionById(sessionId);
  if (!session) {
    throw Object.assign(new Error('Session introuvable'), { status: 404 });
  }

  const existing = await getParticipantByUser(sessionId, userId);
  if (existing) {
    throw Object.assign(new Error('Ce joueur participe déjà à cette session'), { status: 409 });
  }

  if (!session.entry_fee) {
    const { rows } = await pool.query<MinigameParticipantRow>(
      `INSERT INTO minigame_participants (session_id, user_id) VALUES ($1, $2) RETURNING *`,
      [sessionId, userId]
    );
    return rows[0] as MinigameParticipantRow;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await spService.debitSP({
      userId,
      amount: session.entry_fee,
      type: 'minigame_entry',
      seasonId: session.season_id,
      relatedId: session.id,
      note: session.title ?? 'Mini-jeu',
      client,
    });
    const { rows } = await client.query<MinigameParticipantRow>(
      `INSERT INTO minigame_participants (session_id, user_id) VALUES ($1, $2) RETURNING *`,
      [sessionId, userId]
    );
    await client.query('COMMIT');
    return rows[0] as MinigameParticipantRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function removeParticipant(participantId: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM minigame_participants WHERE id = $1 AND awarded_at IS NULL',
    [participantId]
  );
  return (rowCount ?? 0) > 0;
}

export async function getParticipantById(
  participantId: number
): Promise<MinigameParticipantRow | null> {
  const { rows } = await pool.query<MinigameParticipantRow>(
    'SELECT * FROM minigame_participants WHERE id = $1',
    [participantId]
  );
  return rows[0] ?? null;
}

export async function closeSession(id: number): Promise<MinigameSessionRow | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE minigame_questions SET status = 'closed', closed_at = NOW()
       WHERE session_id = $1 AND status = 'active'`,
      [id]
    );
    const { rows } = await client.query<MinigameSessionRow>(
      `UPDATE minigame_sessions SET status = 'closed', closed_at = NOW()
       WHERE id = $1 AND status = 'open'
       RETURNING *`,
      [id]
    );
    await client.query('COMMIT');
    return rows[0] ?? null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Renvoie la question la plus récente de la session (active ou clôturée). Une fois
 * clôturée, le MSP a encore besoin de voir qui a répondu quoi pour décider des
 * récompenses — elle ne disparaît donc que quand une nouvelle question est posée.
 */
export async function getLatestQuestion(sessionId: number): Promise<MinigameQuestionRow | null> {
  const { rows } = await pool.query<MinigameQuestionRow>(
    `SELECT * FROM minigame_questions WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [sessionId]
  );
  return rows[0] ?? null;
}

export async function listQuestions(sessionId: number): Promise<MinigameQuestionRow[]> {
  const { rows } = await pool.query<MinigameQuestionRow>(
    'SELECT * FROM minigame_questions WHERE session_id = $1 ORDER BY created_at DESC',
    [sessionId]
  );
  return rows;
}

export async function getQuestionById(id: number): Promise<MinigameQuestionRow | null> {
  const { rows } = await pool.query<MinigameQuestionRow>(
    'SELECT * FROM minigame_questions WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Publie une nouvelle question en direct pour la session. Ferme automatiquement
 * la question active précédente s'il y en avait une (une seule question visible
 * par les joueurs à la fois).
 */
export async function askQuestion(sessionId: number, prompt: string): Promise<MinigameQuestionRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE minigame_questions SET status = 'closed', closed_at = NOW()
       WHERE session_id = $1 AND status = 'active'`,
      [sessionId]
    );
    const { rows } = await client.query<MinigameQuestionRow>(
      `INSERT INTO minigame_questions (session_id, prompt, status, activated_at)
       VALUES ($1, $2, 'active', NOW())
       RETURNING *`,
      [sessionId, prompt]
    );
    await client.query('COMMIT');
    return rows[0] as MinigameQuestionRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closeQuestion(questionId: number): Promise<MinigameQuestionRow | null> {
  const { rows } = await pool.query<MinigameQuestionRow>(
    `UPDATE minigame_questions SET status = 'closed', closed_at = NOW()
     WHERE id = $1 AND status = 'active'
     RETURNING *`,
    [questionId]
  );
  return rows[0] ?? null;
}

export async function getAnswers(questionId: number): Promise<MinigameAnswerRow[]> {
  const { rows } = await pool.query<MinigameAnswerRow>(
    'SELECT * FROM minigame_answers WHERE question_id = $1 ORDER BY submitted_at ASC',
    [questionId]
  );
  return rows;
}

export async function getAnswer(
  questionId: number,
  userId: number
): Promise<MinigameAnswerRow | null> {
  const { rows } = await pool.query<MinigameAnswerRow>(
    'SELECT * FROM minigame_answers WHERE question_id = $1 AND user_id = $2',
    [questionId, userId]
  );
  return rows[0] ?? null;
}

export async function submitAnswer(
  questionId: number,
  userId: number,
  answerText: string
): Promise<MinigameAnswerRow> {
  const existing = await getAnswer(questionId, userId);
  if (existing) {
    throw Object.assign(new Error('Réponse déjà validée pour cette question'), { status: 409 });
  }
  const { rows } = await pool.query<MinigameAnswerRow>(
    `INSERT INTO minigame_answers (question_id, user_id, answer_text)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [questionId, userId, answerText]
  );
  return rows[0] as MinigameAnswerRow;
}

interface AwardEntry {
  participantId: number;
  amount: number;
}

/**
 * Crédite librement des SP à des participants choisis par le MSP. Chaque
 * attribution (crédit + mise à jour du participant) est atomique. Renvoie la
 * liste des joueurs effectivement crédités (pour notification côté contrôleur).
 */
export async function awardParticipants(
  sessionId: number,
  awards: AwardEntry[],
  awardedBy: number
): Promise<Array<{ userId: number; amount: number }>> {
  const session = await getSessionById(sessionId);
  if (!session) {
    throw Object.assign(new Error('Session introuvable'), { status: 404 });
  }

  const awarded: Array<{ userId: number; amount: number }> = [];

  for (const { participantId, amount } of awards) {
    if (amount <= 0) continue;

    const participant = await getParticipantById(participantId);
    if (!participant || participant.session_id !== sessionId) {
      throw Object.assign(new Error('Participant introuvable'), { status: 404 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await spService.creditSP({
        userId: participant.user_id,
        amount,
        type: 'minigame_reward',
        seasonId: session.season_id,
        relatedId: session.id,
        note: session.title ?? 'Mini-jeu',
        client,
      });
      await client.query(
        `UPDATE minigame_participants
         SET sp_awarded = sp_awarded + $1, awarded_by = $2, awarded_at = NOW()
         WHERE id = $3`,
        [amount, awardedBy, participantId]
      );
      await client.query('COMMIT');
      awarded.push({ userId: participant.user_id, amount });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return awarded;
}
