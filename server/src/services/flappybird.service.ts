import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as cosmeticsService from './cosmetics.service.js';
import type {
  FlappyBirdAttemptEntry,
  FlappyBirdAttemptRow,
  FlappyBirdLeaderboardEntry,
  MinigameSessionRow,
} from '../types.js';

export async function submitScore(
  sessionId: number,
  userId: number,
  score: number
): Promise<FlappyBirdAttemptRow> {
  const { rows } = await pool.query<FlappyBirdAttemptRow>(
    `INSERT INTO flappybird_attempts (session_id, user_id, score)
     VALUES ($1, $2, $3) RETURNING *`,
    [sessionId, userId, score]
  );
  return rows[0] as FlappyBirdAttemptRow;
}

/**
 * Classement (meilleur score par joueur). Départage : en cas d'égalité du meilleur
 * score, le joueur qui l'a atteint EN PREMIER est mieux classé. DISTINCT ON avec
 * ORDER BY score DESC, played_at ASC sélectionne déjà la bonne tentative par joueur ;
 * le tri final ordonne ensuite ces lignes entre elles selon la même règle. Exclut les
 * tentatives invalidées par le MSP et applique le même filtre de visibilité que le
 * reste de l'app (is_leaderboard_hidden / disabled_at).
 */
export async function getLeaderboard(sessionId: number): Promise<FlappyBirdLeaderboardEntry[]> {
  const { rows } = await pool.query<Omit<FlappyBirdLeaderboardEntry, 'equipped_cosmetics'>>(
    `SELECT DISTINCT ON (a.user_id)
       a.user_id, u.username, u.avatar_url, a.score AS best_score, a.played_at AS achieved_at
     FROM flappybird_attempts a
     JOIN users u ON u.id = a.user_id
     WHERE a.session_id = $1
       AND a.excluded_at IS NULL
       AND u.is_leaderboard_hidden = false
       AND u.disabled_at IS NULL
     ORDER BY a.user_id, a.score DESC, a.played_at ASC`,
    [sessionId]
  );

  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));
  const entries = rows.map((row) => ({
    ...row,
    equipped_cosmetics: equippedByUser.get(row.user_id) ?? [],
  }));

  return entries.sort(
    (a, b) =>
      b.best_score - a.best_score ||
      new Date(a.achieved_at).getTime() - new Date(b.achieved_at).getTime()
  );
}

export async function listAttempts(sessionId: number): Promise<FlappyBirdAttemptEntry[]> {
  const { rows } = await pool.query<FlappyBirdAttemptEntry>(
    `SELECT a.*, u.username FROM flappybird_attempts a
     JOIN users u ON u.id = a.user_id
     WHERE a.session_id = $1 ORDER BY a.played_at DESC`,
    [sessionId]
  );
  return rows;
}

export async function getAttemptById(attemptId: number): Promise<FlappyBirdAttemptRow | null> {
  const { rows } = await pool.query<FlappyBirdAttemptRow>(
    'SELECT * FROM flappybird_attempts WHERE id = $1',
    [attemptId]
  );
  return rows[0] ?? null;
}

export async function excludeAttempt(
  attemptId: number,
  excludedBy: number
): Promise<FlappyBirdAttemptRow | null> {
  const { rows } = await pool.query<FlappyBirdAttemptRow>(
    `UPDATE flappybird_attempts SET excluded_at = NOW(), excluded_by = $1
     WHERE id = $2 AND excluded_at IS NULL RETURNING *`,
    [excludedBy, attemptId]
  );
  return rows[0] ?? null;
}

/** Distinct des joueurs ayant tenté au moins une fois — sert à notifier en cas d'annulation. */
export async function listAttemptUserIds(sessionId: number): Promise<number[]> {
  const { rows } = await pool.query<{ user_id: number }>(
    `SELECT DISTINCT user_id FROM flappybird_attempts WHERE session_id = $1`,
    [sessionId]
  );
  return rows.map((r) => r.user_id);
}

/**
 * Annulation par le MSP pendant que la session est encore ouverte (avant ou après
 * la deadline, tant qu'elle n'a pas déjà été clôturée/distribuée) — aucun gain n'est
 * distribué. Statut dédié 'cancelled' (distinct de 'closed', réservé à une clôture
 * normale) — même principe que l'annulation d'un défi. Réclame atomiquement via le
 * WHERE status='open' pour éviter une course avec une clôture/distribution concurrente.
 */
export async function cancelSession(
  sessionId: number,
  cancelledBy: number
): Promise<MinigameSessionRow | null> {
  const { rows } = await pool.query<MinigameSessionRow>(
    `UPDATE minigame_sessions
     SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1
     WHERE id = $2 AND game_type = 'flappy_bird' AND status = 'open'
     RETURNING *`,
    [cancelledBy, sessionId]
  );
  return rows[0] ?? null;
}

export async function updateRewards(
  sessionId: number,
  rewards: { reward1st: number; reward2nd: number; reward3rd: number }
): Promise<MinigameSessionRow | null> {
  const { rows } = await pool.query<MinigameSessionRow>(
    `UPDATE minigame_sessions SET reward_1st = $1, reward_2nd = $2, reward_3rd = $3
     WHERE id = $4 AND game_type = 'flappy_bird' AND status = 'open'
     RETURNING *`,
    [rewards.reward1st, rewards.reward2nd, rewards.reward3rd, sessionId]
  );
  return rows[0] ?? null;
}

/**
 * Clôture + distribution. Réclame atomiquement la clôture (UPDATE...WHERE status='open'
 * AND ends_at <= NOW(), même idiome que minigameService.closeSession) pour qu'un seul
 * appel concurrent gagne la course, puis calcule le top 3 et crédite dans la MÊME
 * transaction (composé via `client`, cf. règle sur les mutations SP dans sp.service.ts).
 * Renvoie `null` si la clôture n'a pas pu être réclamée (session inexistante, pas
 * flappy_bird, déjà close, ou deadline pas encore atteinte) — au contrôleur de
 * distinguer ces cas pour le code d'erreur HTTP.
 */
export async function closeAndDistribute(
  sessionId: number
): Promise<{ session: MinigameSessionRow; awarded: { userId: number; amount: number; rank: number }[] } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: claimed } = await client.query<MinigameSessionRow>(
      `UPDATE minigame_sessions
       SET status = 'closed', closed_at = NOW()
       WHERE id = $1 AND game_type = 'flappy_bird' AND status = 'open'
         AND ends_at IS NOT NULL AND ends_at <= NOW()
       RETURNING *`,
      [sessionId]
    );
    const session = claimed[0];
    if (!session) {
      await client.query('ROLLBACK');
      return null;
    }

    const { rows: board } = await client.query<{ user_id: number; best_score: number; achieved_at: string }>(
      `SELECT DISTINCT ON (a.user_id) a.user_id, a.score AS best_score, a.played_at AS achieved_at
       FROM flappybird_attempts a
       JOIN users u ON u.id = a.user_id
       WHERE a.session_id = $1 AND a.excluded_at IS NULL
         AND u.is_leaderboard_hidden = false AND u.disabled_at IS NULL
       ORDER BY a.user_id, a.score DESC, a.played_at ASC`,
      [sessionId]
    );
    board.sort(
      (a, b) =>
        b.best_score - a.best_score ||
        new Date(a.achieved_at).getTime() - new Date(b.achieved_at).getTime()
    );

    const rewardByRank = [session.reward_1st, session.reward_2nd, session.reward_3rd];
    const awarded: { userId: number; amount: number; rank: number }[] = [];

    for (let i = 0; i < Math.min(3, board.length); i++) {
      const entry = board[i];
      const amount = rewardByRank[i];
      if (!entry || !amount || amount <= 0) continue;
      await spService.creditSP({
        userId: entry.user_id,
        amount,
        type: 'minigame_reward',
        seasonId: session.season_id,
        relatedId: session.id,
        note: session.title ?? 'Flappy Bird',
        client,
      });
      awarded.push({ userId: entry.user_id, amount, rank: i + 1 });
    }

    await client.query('COMMIT');
    return { session, awarded };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
