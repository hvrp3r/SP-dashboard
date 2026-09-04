import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as seasonService from './season.service.js';
import type { SpTransactionEntry, SpTransactionRow, SpTransactionType } from '../types.js';

interface ListUserTransactionsInput {
  userId: number;
  limit: number;
  offset: number;
}

export async function listUserTransactions({
  userId,
  limit,
  offset,
}: ListUserTransactionsInput): Promise<SpTransactionRow[]> {
  const { rows } = await pool.query<SpTransactionRow>(
    `SELECT * FROM sp_transactions
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows;
}

interface ListAllTransactionsFilter {
  userId?: number;
  type?: SpTransactionType;
  seasonId?: number;
  limit: number;
  offset: number;
}

export async function listAllTransactions({
  userId,
  type,
  seasonId,
  limit,
  offset,
}: ListAllTransactionsFilter): Promise<SpTransactionEntry[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (userId !== undefined) {
    params.push(userId);
    conditions.push(`t.user_id = $${params.length}`);
  }
  if (type !== undefined) {
    params.push(type);
    conditions.push(`t.type = $${params.length}`);
  }
  if (seasonId !== undefined) {
    params.push(seasonId);
    conditions.push(`t.season_id = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const { rows } = await pool.query<SpTransactionEntry>(
    `SELECT t.*, u.username
     FROM sp_transactions t
     JOIN users u ON u.id = t.user_id
     ${where}
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

interface CreateManualTransactionInput {
  userId: number;
  type: 'admin_grant' | 'admin_deduct';
  amount: number;
  note: string | null;
  affectsTotalEarned: boolean;
}

/**
 * Crée manuellement un crédit ou un débit SP pour un joueur (passe par les
 * fonctions centrales creditSP/debitSP, donc journalisé et sujet aux mêmes
 * garanties : jamais de solde négatif). Le MSP choisit si cette transaction
 * impacte sp_total_earned (classement "total gagné") ou seulement sp_balance.
 */
export async function createManualTransaction({
  userId,
  type,
  amount,
  note,
  affectsTotalEarned,
}: CreateManualTransactionInput): Promise<SpTransactionRow> {
  const activeSeason = await seasonService.getActiveSeason();
  const seasonId = activeSeason?.id ?? null;

  if (type === 'admin_grant') {
    return spService.creditSP({ userId, amount, type, seasonId, note, affectsTotalEarned });
  }
  return spService.debitSP({ userId, amount, type, seasonId, note, affectsTotalEarned });
}

export async function getTransactionEntryById(id: number): Promise<SpTransactionEntry | null> {
  const { rows } = await pool.query<SpTransactionEntry>(
    `SELECT t.*, u.username FROM sp_transactions t JOIN users u ON u.id = t.user_id WHERE t.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Révoque une transaction : crédite/débite l'inverse du montant d'origine (via les
 * fonctions centrales creditSP/debitSP, donc journalisé comme une nouvelle transaction
 * admin_grant/admin_deduct) et marque la transaction d'origine comme révoquée. On ne
 * supprime jamais une ligne d'historique.
 */
export async function revokeTransaction(
  transactionId: number,
  adminId: number
): Promise<SpTransactionRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<SpTransactionRow>(
      'SELECT * FROM sp_transactions WHERE id = $1 FOR UPDATE',
      [transactionId]
    );
    const tx = rows[0];
    if (!tx) {
      throw Object.assign(new Error('Transaction introuvable'), { status: 404 });
    }
    if (tx.revoked_at) {
      throw Object.assign(new Error('Cette transaction a déjà été révoquée'), { status: 400 });
    }

    if (tx.season_id !== null) {
      const { rows: seasonRows } = await client.query<{ status: string }>(
        'SELECT status FROM seasons WHERE id = $1',
        [tx.season_id]
      );
      if (seasonRows[0]?.status === 'closed') {
        throw Object.assign(
          new Error('Impossible de révoquer une transaction d’une saison archivée'),
          { status: 400 }
        );
      }
    }

    const amount = Math.abs(tx.amount);
    if (amount > 0) {
      if (tx.amount > 0) {
        await spService.debitSP({
          userId: tx.user_id,
          amount,
          type: 'admin_deduct',
          seasonId: tx.season_id,
          relatedId: tx.id,
          note: `Révocation de la transaction #${tx.id}`,
          affectsTotalEarned: tx.affects_total_earned,
          client,
        });
      } else {
        await spService.creditSP({
          userId: tx.user_id,
          amount,
          type: 'admin_grant',
          seasonId: tx.season_id,
          relatedId: tx.id,
          note: `Révocation de la transaction #${tx.id}`,
          affectsTotalEarned: tx.affects_total_earned,
          client,
        });
      }
    }

    const { rows: updated } = await client.query<SpTransactionRow>(
      `UPDATE sp_transactions SET revoked_at = NOW(), revoked_by = $1 WHERE id = $2 RETURNING *`,
      [adminId, transactionId]
    );

    await client.query('COMMIT');
    return updated[0] as SpTransactionRow;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
