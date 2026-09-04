import type { Request, Response } from 'express';
import * as transactionService from '../services/transaction.service.js';
import * as userService from '../services/user.service.js';
import * as notificationService from '../services/notification.service.js';
import type { SpTransactionType } from '../types.js';

const VALID_TYPES: SpTransactionType[] = [
  'login_bonus',
  'challenge_win',
  'challenge_loss',
  'minigame_reward',
  'admin_grant',
  'admin_deduct',
];

function parsePagination(req: Request): { limit: number; offset: number } {
  const limitRaw = Number(req.query.limit);
  const offsetRaw = Number(req.query.offset);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
  return { limit, offset };
}

export async function listMyTransactions(req: Request, res: Response): Promise<void> {
  const { limit, offset } = parsePagination(req);
  const transactions = await transactionService.listUserTransactions({
    userId: req.user!.id,
    limit,
    offset,
  });
  res.json(transactions);
}

export async function listAllTransactions(req: Request, res: Response): Promise<void> {
  const { limit, offset } = parsePagination(req);

  const typeParam = req.query.type as string | undefined;
  if (typeParam && !VALID_TYPES.includes(typeParam as SpTransactionType)) {
    res.status(400).json({ error: 'Type de transaction invalide' });
    return;
  }

  const userIdParam = req.query.userId ? Number(req.query.userId) : undefined;
  const seasonIdParam = req.query.seasonId ? Number(req.query.seasonId) : undefined;

  const transactions = await transactionService.listAllTransactions({
    userId: Number.isInteger(userIdParam) ? userIdParam : undefined,
    type: typeParam as SpTransactionType | undefined,
    seasonId: Number.isInteger(seasonIdParam) ? seasonIdParam : undefined,
    limit,
    offset,
  });
  res.json(transactions);
}

interface CreateTransactionBody {
  userId?: number;
  type?: 'admin_grant' | 'admin_deduct';
  amount?: number;
  note?: string;
  affectsTotalEarned?: boolean;
}

export async function createTransaction(
  req: Request<{}, {}, CreateTransactionBody>,
  res: Response
): Promise<void> {
  const { userId, type, amount, note, affectsTotalEarned } = req.body ?? {};

  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: 'Le joueur est requis' });
    return;
  }
  if (type !== 'admin_grant' && type !== 'admin_deduct') {
    res.status(400).json({ error: 'Type invalide (crédit ou débit)' });
    return;
  }
  if (!Number.isInteger(amount) || (amount as number) <= 0) {
    res.status(400).json({ error: 'Le montant doit être un entier positif' });
    return;
  }
  if (affectsTotalEarned !== undefined && typeof affectsTotalEarned !== 'boolean') {
    res.status(400).json({ error: 'affectsTotalEarned doit être un booléen' });
    return;
  }

  const player = await userService.findById(userId as number);
  if (!player) {
    res.status(404).json({ error: 'Joueur introuvable' });
    return;
  }

  let created;
  try {
    created = await transactionService.createManualTransaction({
      userId: userId as number,
      type,
      amount: amount as number,
      note: note?.trim() || null,
      affectsTotalEarned: affectsTotalEarned ?? (type === 'admin_grant'),
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  await notificationService.createNotification({
    userId: userId as number,
    type: type === 'admin_grant' ? 'sp_gained' : 'sp_lost',
    message:
      type === 'admin_grant'
        ? `Le MSP t'a accordé +${amount} SP${note ? ` (${note.trim()})` : ''}`
        : `Le MSP t'a retiré ${amount} SP${note ? ` (${note.trim()})` : ''}`,
    link: '/profil',
  });

  const entry = await transactionService.getTransactionEntryById(created.id);
  res.status(201).json(entry);
}

export async function revokeTransaction(req: Request<{ id: string }>, res: Response): Promise<void> {
  const transactionId = Number(req.params.id);
  if (!Number.isInteger(transactionId)) {
    res.status(400).json({ error: 'Identifiant de transaction invalide' });
    return;
  }

  let revoked;
  try {
    revoked = await transactionService.revokeTransaction(transactionId, req.user!.id);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  // revoked.amount est le montant d'origine ; l'ajustement appliqué est son inverse.
  const adjustment = -revoked.amount;
  if (adjustment !== 0) {
    await notificationService.createNotification({
      userId: revoked.user_id,
      type: adjustment > 0 ? 'sp_gained' : 'sp_lost',
      message: `Une de tes transactions a été révoquée par le MSP. Ajustement : ${adjustment >= 0 ? '+' : ''}${adjustment} SP`,
      link: '/profil',
    });
  }

  const entry = await transactionService.getTransactionEntryById(transactionId);
  res.json(entry);
}
