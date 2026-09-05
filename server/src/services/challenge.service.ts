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
}

export async function createChallenge({
  seasonId,
  challengerId,
  opponentIds,
  wagerAmount,
  description,
}: CreateChallengeInput): Promise<ChallengeRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<ChallengeRow>(
      `INSERT INTO challenges (season_id, challenger_id, wager_amount, description, status, expires_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW() + INTERVAL '24 hours')
       RETURNING *`,
      [seasonId, challengerId, wagerAmount, description]
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
  response: 'accepted' | 'declined'
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE challenge_participants SET status = $1, responded_at = NOW()
       WHERE challenge_id = $2 AND user_id = $3 AND status = 'pending'`,
      [response, challengeId, userId]
    );
    if (!rowCount) {
      throw Object.assign(new Error('Réponse déjà enregistrée ou tu ne fais pas partie de ce défi'), {
        status: 400,
      });
    }
    await finalizeIfComplete(client, challengeId);
    await client.query('COMMIT');
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

    await client.query('COMMIT');
    return updatedRows[0] as ChallengeRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
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
