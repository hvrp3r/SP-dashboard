import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { SpTransactionRow, SpTransactionType } from '../types.js';

interface SpMutationInput {
  userId: number;
  amount: number;
  type: SpTransactionType;
  seasonId: number | null;
  relatedId?: number | null;
  note?: string | null;
  /** Connexion d'une transaction déjà ouverte par l'appelant (pour composer avec un autre verrou de ligne). */
  client?: PoolClient;
}

async function insertCredit(client: PoolClient, input: SpMutationInput): Promise<SpTransactionRow> {
  const { userId, amount, type, seasonId, relatedId = null, note = null } = input;

  await client.query(
    'UPDATE users SET sp_balance = sp_balance + $1, sp_total_earned = sp_total_earned + $1 WHERE id = $2',
    [amount, userId]
  );

  const { rows } = await client.query<SpTransactionRow>(
    `INSERT INTO sp_transactions (user_id, season_id, amount, type, related_id, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, seasonId, amount, type, relatedId, note]
  );
  return rows[0] as SpTransactionRow;
}

export async function creditSP(input: SpMutationInput): Promise<SpTransactionRow> {
  if (input.amount <= 0) {
    throw new Error('Le montant crédité doit être positif');
  }

  if (input.client) {
    return insertCredit(input.client, input);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await insertCredit(client, input);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function performDebit(client: PoolClient, input: SpMutationInput): Promise<SpTransactionRow> {
  const { userId, amount, type, seasonId, relatedId = null, note = null } = input;

  const { rows: userRows } = await client.query<{ sp_balance: number }>(
    'SELECT sp_balance FROM users WHERE id = $1 FOR UPDATE',
    [userId]
  );
  const balance = userRows[0]?.sp_balance;
  if (balance === undefined) {
    throw Object.assign(new Error('Utilisateur introuvable'), { status: 404 });
  }
  if (balance < amount) {
    throw Object.assign(new Error('Solde SP insuffisant'), { status: 400 });
  }

  await client.query('UPDATE users SET sp_balance = sp_balance - $1 WHERE id = $2', [
    amount,
    userId,
  ]);

  const { rows } = await client.query<SpTransactionRow>(
    `INSERT INTO sp_transactions (user_id, season_id, amount, type, related_id, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, seasonId, -amount, type, relatedId, note]
  );
  return rows[0] as SpTransactionRow;
}

export async function debitSP(input: SpMutationInput): Promise<SpTransactionRow> {
  if (input.amount <= 0) {
    throw new Error('Le montant débité doit être positif');
  }

  if (input.client) {
    return performDebit(input.client, input);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await performDebit(client, input);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
