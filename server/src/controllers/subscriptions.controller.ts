import type { Request, Response } from 'express';
import * as subscriptionService from '../services/subscription.service.js';
import * as usersService from '../services/user.service.js';
import type { KofiWebhookPayload } from '../types.js';

export async function getMine(req: Request, res: Response): Promise<void> {
  const sub = await subscriptionService.getOrCreateForUser(req.user!.id);
  res.json({ ...sub, isActive: subscriptionService.isActive(sub) });
}

/**
 * Ko-fi POSTe en application/x-www-form-urlencoded, un unique champ `data`
 * contenant le JSON de l'événement (voir subscriptions.routes.ts pour le
 * middleware de parsing dédié). Toujours répondre 200 une fois l'événement
 * traité (même non rattaché) : Ko-fi retente sinon indéfiniment le même
 * message_id, ce qui ne changerait rien à un paiement déjà non-matché.
 */
export async function kofiWebhook(req: Request, res: Response): Promise<void> {
  const configuredToken = process.env.KOFI_VERIFICATION_TOKEN;
  if (!configuredToken) {
    console.error("KOFI_VERIFICATION_TOKEN n'est pas configuré — webhook Ko-fi ignoré");
    res.status(503).json({ error: 'Webhook non configuré côté serveur' });
    return;
  }

  const raw = (req.body as { data?: string } | undefined)?.data;
  let payload: KofiWebhookPayload;
  try {
    payload = JSON.parse(raw ?? '');
  } catch {
    res.status(400).json({ error: 'Payload invalide' });
    return;
  }

  if (payload.verification_token !== configuredToken) {
    res.status(401).json({ error: 'Token de vérification invalide' });
    return;
  }

  await subscriptionService.recordAndResolveKofiPayment(payload);
  res.status(200).json({ ok: true });
}

export async function listAll(req: Request, res: Response): Promise<void> {
  const subs = await subscriptionService.listAllWithUser();
  res.json(subs);
}

export async function listUnmatched(req: Request, res: Response): Promise<void> {
  const events = await subscriptionService.listUnmatchedEvents();
  res.json(events);
}

interface MatchUnmatchedBody {
  userId?: number;
}

export async function matchUnmatched(
  req: Request<{ eventId: string }, {}, MatchUnmatchedBody>,
  res: Response
): Promise<void> {
  const eventId = Number(req.params.eventId);
  const userId = req.body?.userId;
  if (!Number.isInteger(eventId) || !Number.isInteger(userId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }

  const target = await usersService.findById(userId as number);
  if (!target) {
    res.status(404).json({ error: 'Joueur introuvable' });
    return;
  }

  try {
    const sub = await subscriptionService.matchEvent(eventId, userId as number);
    res.json(sub);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
  }
}

interface AdminSetStatusBody {
  status?: 'active' | 'inactive';
  currentPeriodEnd?: string | null;
}

export async function adminSetStatus(
  req: Request<{ userId: string }, {}, AdminSetStatusBody>,
  res: Response
): Promise<void> {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }
  const status = req.body?.status;
  if (status !== 'active' && status !== 'inactive') {
    res.status(400).json({ error: 'Statut invalide' });
    return;
  }
  if (status === 'active' && !req.body?.currentPeriodEnd) {
    res.status(400).json({ error: "Une date de fin d'accès est requise pour activer l'abonnement" });
    return;
  }

  const target = await usersService.findById(userId);
  if (!target) {
    res.status(404).json({ error: 'Joueur introuvable' });
    return;
  }

  const currentPeriodEnd = req.body?.currentPeriodEnd ? new Date(req.body.currentPeriodEnd) : null;
  const sub = await subscriptionService.adminSetStatus(
    userId,
    { status, currentPeriodEnd },
    req.user!.id
  );
  res.json(sub);
}
