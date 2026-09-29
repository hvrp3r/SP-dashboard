import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as transactionService from './transaction.service.js';
import * as cosmeticsService from './cosmetics.service.js';
import type {
  ChallengeEntry,
  ChallengeParticipantEntry,
  ChallengeParticipantRow,
  ChallengeRow,
  ChallengeStatus,
  ChallengeType,
  CoinSide,
  RpsMove,
  RpsRound,
} from '../types.js';

export async function countChallengesToday(userId: number): Promise<number> {
  const todayStart = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM challenges WHERE challenger_id = $1 AND created_at >= $2 AND created_at < $3`,
    [userId, todayStart.toISOString(), todayEnd.toISOString()]
  );
  return Number(rows[0]?.count ?? 0);
}

interface CreateChallengeInput {
  seasonId: number | null;
  challengerId: number;
  opponentIds: number[];
  wagerAmount: number;
  description: string | null;
  type: ChallengeType;
}

export async function createChallenge({
  seasonId,
  challengerId,
  opponentIds,
  wagerAmount,
  description,
  type,
}: CreateChallengeInput): Promise<ChallengeRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<ChallengeRow>(
      `INSERT INTO challenges (season_id, challenger_id, wager_amount, description, type, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW() + INTERVAL '24 hours')
       RETURNING *`,
      [seasonId, challengerId, wagerAmount, description, type]
    );
    const challenge = rows[0] as ChallengeRow;

    await client.query(
      `INSERT INTO challenge_participants (challenge_id, user_id, is_challenger, status, responded_at)
       VALUES ($1, $2, TRUE, 'accepted', NOW())`,
      [challenge.id, challengerId]
    );
    for (const opponentId of opponentIds) {
      await client.query(
        `INSERT INTO challenge_participants (challenge_id, user_id, is_challenger, status)
         VALUES ($1, $2, FALSE, 'pending')`,
        [challenge.id, opponentId]
      );
    }

    await client.query('COMMIT');
    return challenge;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getChallengeById(id: number): Promise<ChallengeRow | null> {
  const { rows } = await pool.query<ChallengeRow>('SELECT * FROM challenges WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function getParticipants(challengeId: number): Promise<ChallengeParticipantEntry[]> {
  const { rows } = await pool.query<Omit<ChallengeParticipantEntry, 'equipped_cosmetics'>>(
    `SELECT p.*, u.username, u.avatar_url
     FROM challenge_participants p
     JOIN users u ON u.id = p.user_id
     WHERE p.challenge_id = $1
     ORDER BY p.is_challenger DESC, p.id ASC`,
    [challengeId]
  );
  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));
  return rows.map((row) => ({
    ...row,
    equipped_cosmetics: equippedByUser.get(row.user_id) ?? [],
  }));
}

export async function getChallengeEntryById(id: number): Promise<ChallengeEntry | null> {
  const challenge = await getChallengeById(id);
  if (!challenge) return null;
  const participants = await getParticipants(id);
  return { ...challenge, participants };
}

export async function listMyChallenges(userId: number): Promise<ChallengeEntry[]> {
  const { rows } = await pool.query<{ id: number }>(
    `SELECT c.id
     FROM challenges c
     JOIN challenge_participants p ON p.challenge_id = c.id AND p.user_id = $1
     ORDER BY c.created_at DESC`,
    [userId]
  );
  const entries = await Promise.all(rows.map((r) => getChallengeEntryById(r.id)));
  return entries.filter((e): e is ChallengeEntry => e !== null);
}

interface ListAllChallengesFilter {
  status?: ChallengeStatus;
}

export async function listAllChallenges({
  status,
}: ListAllChallengesFilter): Promise<ChallengeEntry[]> {
  const where = status ? 'WHERE status = $1' : '';
  const params = status ? [status] : [];
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM challenges ${where} ORDER BY created_at DESC`,
    params
  );
  const entries = await Promise.all(rows.map((r) => getChallengeEntryById(r.id)));
  return entries.filter((e): e is ChallengeEntry => e !== null);
}

/**
 * Une fois qu'aucun participant n'est plus "pending" (tous ont répondu, ou ont
 * été forcés à "declined" par expiration), fait basculer le défi vers
 * "accepted" s'il reste au moins 2 participants ayant accepté (de quoi jouer),
 * sinon vers "declined" (rien à jouer, que ce soit par refus explicite ou par
 * expiration — la distinction n'a plus d'intérêt une fois généralisée à N joueurs).
 * Retourne le nouveau statut, ou null si le défi attend encore des réponses.
 */
async function finalizeIfComplete(
  client: PoolClient,
  challengeId: number
): Promise<ChallengeStatus | null> {
  const { rows: pendingRows } = await client.query<{ count: string }>(
    `SELECT COUNT(*) FROM challenge_participants WHERE challenge_id = $1 AND status = 'pending'`,
    [challengeId]
  );
  if (Number(pendingRows[0]?.count ?? 0) > 0) return null;

  const { rows: acceptedRows } = await client.query<{ count: string }>(
    `SELECT COUNT(*) FROM challenge_participants WHERE challenge_id = $1 AND status = 'accepted'`,
    [challengeId]
  );
  const acceptedCount = Number(acceptedRows[0]?.count ?? 0);
  const newStatus: ChallengeStatus = acceptedCount >= 2 ? 'accepted' : 'declined';
  await client.query(`UPDATE challenges SET status = $1 WHERE id = $2 AND status = 'pending'`, [
    newStatus,
    challengeId,
  ]);
  return newStatus;
}

export async function respondToChallenge(
  challengeId: number,
  userId: number,
  response: 'accepted' | 'declined',
  coinSide?: CoinSide
): Promise<ChallengeStatus | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE challenge_participants SET status = $1, responded_at = NOW(), coin_side = COALESCE($4, coin_side)
       WHERE challenge_id = $2 AND user_id = $3 AND status = 'pending'`,
      [response, challengeId, userId, coinSide ?? null]
    );
    if (!rowCount) {
      throw Object.assign(new Error('Réponse déjà enregistrée ou tu ne fais pas partie de ce défi'), {
        status: 400,
      });
    }
    // Pile ou face : dès que le joueur défié a choisi son côté, le challenger
    // hérite automatiquement du côté opposé — lui ne choisit jamais.
    if (coinSide) {
      const otherSide: CoinSide = coinSide === 'pile' ? 'face' : 'pile';
      await client.query(
        `UPDATE challenge_participants SET coin_side = $1 WHERE challenge_id = $2 AND user_id != $3`,
        [otherSide, challengeId, userId]
      );
    }
    const finalStatus = await finalizeIfComplete(client, challengeId);
    await client.query('COMMIT');
    return finalStatus;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function submitReport(
  challengeId: number,
  userId: number,
  winnerId: number
): Promise<void> {
  await pool.query(
    `UPDATE challenge_participants SET reported_winner_id = $1
     WHERE challenge_id = $2 AND user_id = $3 AND status = 'accepted'`,
    [winnerId, challengeId, userId]
  );
}

export async function expirePendingChallenges(): Promise<
  Array<{ id: number; challenger_id: number; finalStatus: ChallengeStatus }>
> {
  const client = await pool.connect();
  const results: Array<{ id: number; challenger_id: number; finalStatus: ChallengeStatus }> = [];
  try {
    await client.query('BEGIN');
    const { rows: expiredChallenges } = await client.query<{ id: number; challenger_id: number }>(
      `SELECT id, challenger_id FROM challenges WHERE status = 'pending' AND expires_at < NOW() FOR UPDATE`
    );
    for (const c of expiredChallenges) {
      await client.query(
        `UPDATE challenge_participants SET status = 'declined', responded_at = NOW()
         WHERE challenge_id = $1 AND status = 'pending'`,
        [c.id]
      );
      const finalStatus = await finalizeIfComplete(client, c.id);
      if (finalStatus) results.push({ id: c.id, challenger_id: c.challenger_id, finalStatus });
    }
    await client.query('COMMIT');
    return results;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function resolveChallenge(
  challengeId: number,
  winnerId: number,
  resolvedByAdmin: boolean,
  resultNote?: string | null
): Promise<ChallengeRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resolved = await resolveChallengeWithClient(
      client,
      challengeId,
      winnerId,
      resolvedByAdmin,
      resultNote
    );
    await client.query('COMMIT');
    return resolved;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Cœur de resolveChallenge, à composer dans une transaction déjà ouverte par l'appelant. */
async function resolveChallengeWithClient(
  client: PoolClient,
  challengeId: number,
  winnerId: number,
  resolvedByAdmin: boolean,
  resultNote?: string | null
): Promise<ChallengeRow> {
  const { rows } = await client.query<ChallengeRow>(
    'SELECT * FROM challenges WHERE id = $1 FOR UPDATE',
    [challengeId]
  );
  const challenge = rows[0];
  if (!challenge) {
    throw Object.assign(new Error('Défi introuvable'), { status: 404 });
  }
  if (challenge.status === 'resolved') {
    throw Object.assign(new Error('Ce défi est déjà résolu'), { status: 400 });
  }
  if (challenge.status !== 'accepted') {
    throw Object.assign(new Error('Ce défi ne peut pas être résolu dans son état actuel'), {
      status: 400,
    });
  }

  const { rows: participants } = await client.query<ChallengeParticipantRow>(
    `SELECT * FROM challenge_participants WHERE challenge_id = $1 AND status = 'accepted' FOR UPDATE`,
    [challengeId]
  );
  if (participants.length < 2) {
    throw Object.assign(new Error('Il faut au moins deux participants pour résoudre un défi'), {
      status: 400,
    });
  }
  const winnerParticipant = participants.find((p) => p.user_id === winnerId);
  if (!winnerParticipant) {
    throw Object.assign(
      new Error('Le gagnant doit être un participant ayant accepté le défi'),
      { status: 400 }
    );
  }

  const losers = participants.filter((p) => p.user_id !== winnerId);
  for (const loser of losers) {
    await spService.debitSP({
      userId: loser.user_id,
      amount: challenge.wager_amount,
      type: 'challenge_loss',
      seasonId: challenge.season_id,
      relatedId: challenge.id,
      note: resolvedByAdmin ? 'Défi perdu (arbitrage MSP)' : 'Défi perdu',
      client,
    });
  }
  await spService.creditSP({
    userId: winnerId,
    amount: challenge.wager_amount * losers.length,
    type: 'challenge_win',
    seasonId: challenge.season_id,
    relatedId: challenge.id,
    note: resolvedByAdmin ? 'Défi gagné (arbitrage MSP)' : 'Défi gagné',
    client,
  });

  const { rows: updatedRows } = await client.query<ChallengeRow>(
    `UPDATE challenges
     SET status = 'resolved', winner_id = $1, resolved_at = NOW(), result_note = COALESCE($2, result_note)
     WHERE id = $3
     RETURNING *`,
    [winnerId, resultNote ?? null, challengeId]
  );

  return updatedRows[0] as ChallengeRow;
}

const RPS_BEATS: Record<RpsMove, RpsMove> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

/** Manches gagnées nécessaires pour remporter la partie (en 3 manches gagnantes max). */
export const RPS_WINS_NEEDED = 2;

export type RpsRoundOutcome =
  | { outcome: 'waiting' }
  | { outcome: 'round'; winnerId: number | null }
  | { outcome: 'resolved'; winnerId: number };

/**
 * Pierre-feuille-ciseaux : joue la manche en cours si les deux participants ont
 * posé leur coup. La manche est archivée dans rps_rounds et les coups remis à
 * NULL pour la suivante. La partie se joue en 3 manches : le premier à
 * RPS_WINS_NEEDED manches gagnées l'emporte — une égalité ne compte pour
 * personne et se rejoue. Dès qu'un joueur atteint ce seuil, le défi est résolu
 * dans la même transaction (si la résolution échoue, rien n'est modifié — le
 * MSP arbitre). Le verrou sur la ligne du défi sérialise deux coups simultanés.
 */
export async function playRpsRoundIfReady(challengeId: number): Promise<RpsRoundOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<ChallengeRow>(
      'SELECT * FROM challenges WHERE id = $1 FOR UPDATE',
      [challengeId]
    );
    const challenge = rows[0];
    const { rows: participants } = await client.query<ChallengeParticipantRow>(
      `SELECT * FROM challenge_participants WHERE challenge_id = $1 AND status = 'accepted'`,
      [challengeId]
    );
    const [a, b] = participants;
    if (
      !challenge ||
      challenge.type !== 'rps' ||
      challenge.status !== 'accepted' ||
      participants.length !== 2 ||
      !a?.rps_move ||
      !b?.rps_move
    ) {
      await client.query('COMMIT');
      return { outcome: 'waiting' };
    }

    let winnerId: number | null = null;
    if (RPS_BEATS[a.rps_move] === b.rps_move) winnerId = a.user_id;
    else if (RPS_BEATS[b.rps_move] === a.rps_move) winnerId = b.user_id;

    const round: RpsRound = {
      moves: { [a.user_id]: a.rps_move, [b.user_id]: b.rps_move },
      winner_id: winnerId,
    };
    await client.query(`UPDATE challenges SET rps_rounds = rps_rounds || $1::jsonb WHERE id = $2`, [
      JSON.stringify([round]),
      challengeId,
    ]);
    await client.query(`UPDATE challenge_participants SET rps_move = NULL WHERE challenge_id = $1`, [
      challengeId,
    ]);

    const roundsWon =
      winnerId === null
        ? 0
        : [...(challenge.rps_rounds ?? []), round].filter((r) => r.winner_id === winnerId).length;
    if (winnerId !== null && roundsWon >= RPS_WINS_NEEDED) {
      await resolveChallengeWithClient(client, challengeId, winnerId, false, 'Pierre-feuille-ciseaux');
      await client.query('COMMIT');
      return { outcome: 'resolved', winnerId };
    }
    await client.query('COMMIT');
    return { outcome: 'round', winnerId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Pose le coup d'un participant pour la manche en cours (défi déjà accepté par les deux). */
export async function submitRpsMove(
  challengeId: number,
  userId: number,
  move: RpsMove
): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE challenge_participants p SET rps_move = $1
     FROM challenges c
     WHERE c.id = p.challenge_id AND c.id = $2 AND c.type = 'rps' AND c.status = 'accepted'
       AND p.user_id = $3 AND p.status = 'accepted' AND p.rps_move IS NULL`,
    [move, challengeId, userId]
  );
  if (!rowCount) {
    throw Object.assign(new Error("Coup déjà joué, ou ce défi n'attend pas de coup de ta part"), {
      status: 400,
    });
  }
}

/**
 * Annule un défi (MSP uniquement). S'il était résolu, révoque les transactions SP
 * associées (gain du vainqueur + pertes des autres participants) via la révocation
 * de transaction standard — même garanties : jamais de solde négatif, saison
 * archivée bloque la révocation, jamais de double révocation. Le gain du vainqueur
 * (montant positif, le plus susceptible d'échouer par solde insuffisant) est
 * révoqué en premier : si ça échoue, rien n'est modifié plutôt que de laisser le
 * défi à moitié annulé.
 */
export async function cancelChallenge(challengeId: number, adminId: number): Promise<ChallengeRow> {
  const challenge = await getChallengeById(challengeId);
  if (!challenge) {
    throw Object.assign(new Error('Défi introuvable'), { status: 404 });
  }
  if (challenge.status === 'cancelled') {
    throw Object.assign(new Error('Ce défi est déjà annulé'), { status: 400 });
  }
  if (
    challenge.status !== 'pending' &&
    challenge.status !== 'accepted' &&
    challenge.status !== 'resolved'
  ) {
    throw Object.assign(new Error('Ce défi ne peut pas être annulé dans son état actuel'), {
      status: 400,
    });
  }

  if (challenge.status === 'resolved') {
    const { rows: relatedTransactions } = await pool.query<{ id: number }>(
      `SELECT id FROM sp_transactions
       WHERE related_id = $1 AND type IN ('challenge_win', 'challenge_loss') AND revoked_at IS NULL
       ORDER BY amount DESC`,
      [challengeId]
    );
    for (const tx of relatedTransactions) {
      await transactionService.revokeTransaction(tx.id, adminId);
    }
  }

  const { rows } = await pool.query<ChallengeRow>(
    `UPDATE challenges SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1
     WHERE id = $2
     RETURNING *`,
    [adminId, challengeId]
  );
  return rows[0] as ChallengeRow;
}
