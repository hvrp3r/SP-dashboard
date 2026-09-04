import crypto from 'node:crypto';
import { pool } from '../db/pool.js';
import * as configService from './config.service.js';
import type { KofiEventRow, KofiWebhookPayload, SubscriptionEntry, SubscriptionRow } from '../types.js';

// Charset sans caractères ambigus (0/O, 1/I/L) : le code est destiné à être
// recopié à la main dans le champ message de Ko-fi.
const LINK_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LINK_CODE_LENGTH = 8;
const UNIQUE_VIOLATION = '23505';

function generateLinkCode(): string {
  let code = '';
  for (let i = 0; i < LINK_CODE_LENGTH; i++) {
    code += LINK_CODE_CHARS[crypto.randomInt(LINK_CODE_CHARS.length)];
  }
  return code;
}

/**
 * Crée la ligne d'abonnement (inactive, avec un code de liaison fraîchement
 * généré) au premier accès du joueur à son profil/abonnement — pas de hook à
 * l'inscription, une ligne n'existe que pour les joueurs qui ont consulté la
 * section Abonnement au moins une fois.
 */
export async function getOrCreateForUser(userId: number): Promise<SubscriptionRow> {
  const { rows } = await pool.query<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE user_id = $1',
    [userId]
  );
  if (rows[0]) return rows[0];

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rows: inserted } = await pool.query<SubscriptionRow>(
        `INSERT INTO subscriptions (user_id, link_code) VALUES ($1, $2) RETURNING *`,
        [userId, generateLinkCode()]
      );
      return inserted[0] as SubscriptionRow;
    } catch (err) {
      // Collision sur link_code (extrêmement improbable, 32^8 possibilités) : on retente.
      if ((err as { code?: string }).code !== UNIQUE_VIOLATION) throw err;
    }
  }
  throw new Error("Impossible de générer un code de liaison d'abonnement");
}

export function isActive(sub: Pick<SubscriptionRow, 'status' | 'current_period_end'>): boolean {
  return (
    sub.status === 'active' &&
    sub.current_period_end !== null &&
    new Date(sub.current_period_end) > new Date()
  );
}

async function findByLinkCode(code: string): Promise<SubscriptionRow | null> {
  const { rows } = await pool.query<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE link_code = $1',
    [code]
  );
  return rows[0] ?? null;
}

async function findByKofiEmail(email: string): Promise<SubscriptionRow | null> {
  const { rows } = await pool.query<SubscriptionRow>(
    'SELECT * FROM subscriptions WHERE lower(kofi_email) = lower($1)',
    [email]
  );
  return rows[0] ?? null;
}

async function activateFromPayment(
  userId: number,
  kofiEmail: string,
  paidAt: Date
): Promise<SubscriptionRow> {
  const periodDays = await configService.getConfigNumber('kofi_subscription_period_days', 35);
  const periodEnd = new Date(paidAt.getTime() + periodDays * 24 * 60 * 60 * 1000);
  const { rows } = await pool.query<SubscriptionRow>(
    `UPDATE subscriptions
     SET status = 'active', kofi_email = $1, current_period_end = $2, last_payment_at = $3,
         activated_by = NULL, updated_at = NOW()
     WHERE user_id = $4
     RETURNING *`,
    [kofiEmail || null, periodEnd, paidAt, userId]
  );
  return rows[0] as SubscriptionRow;
}

/**
 * Un don ponctuel ("one time" sur le widget Ko-fi) donne le même statut
 * abonné qu'un paiement d'abonnement récurrent ("monthly") — décision
 * explicite de l'utilisateur. Les Shop Orders/Commissions ne comptent jamais,
 * ce n'est pas le même geste de soutien que le widget "Support".
 *
 * Pas de montant minimum vérifié ici : le prix plancher est configuré
 * directement sur la page Ko-fi (réglages du widget), pas dupliqué côté app
 * — décision explicite de l'utilisateur pour n'avoir qu'une seule source de
 * vérité sur le prix.
 */
function isEligiblePaymentType(payload: KofiWebhookPayload): boolean {
  return payload.is_subscription_payment || payload.type === 'Donation';
}

/**
 * Enregistre un paiement Ko-fi et tente de le rattacher à un compte, dans
 * l'ordre : code de liaison, puis email Ko-fi déjà connu. Idempotent sur
 * kofi_transaction_id : Ko-fi retente l'envoi tant qu'il ne reçoit pas un
 * 200, un même paiement ne doit donc jamais être traité deux fois.
 *
 * Piège Ko-fi : le champ `message` n'est fourni que sur le tout premier
 * paiement d'un abonnement (`is_first_subscription_payment`) — les
 * renouvellements suivants arrivent avec un message vide, systématiquement.
 * En revanche un don ponctuel ("Donation") porte toujours son message,
 * qu'il soit le premier ou le centième — pas de restriction "premier
 * paiement" à appliquer dans ce cas.
 */
export async function recordAndResolveKofiPayment(
  payload: KofiWebhookPayload
): Promise<{ matchedUserId: number | null; alreadyProcessed: boolean }> {
  const { rows: existing } = await pool.query<{ matched_user_id: number | null }>(
    'SELECT matched_user_id FROM kofi_events WHERE kofi_transaction_id = $1',
    [payload.kofi_transaction_id]
  );
  if (existing[0]) {
    return { matchedUserId: existing[0].matched_user_id, alreadyProcessed: true };
  }

  let matchedUserId: number | null = null;

  if (isEligiblePaymentType(payload)) {
    const codeCanAppear = payload.is_subscription_payment
      ? payload.is_first_subscription_payment
      : true;
    const pastedCode = payload.message?.trim().toUpperCase();
    if (codeCanAppear && pastedCode) {
      const sub = await findByLinkCode(pastedCode);
      if (sub) matchedUserId = sub.user_id;
    }
    if (!matchedUserId && payload.email) {
      const sub = await findByKofiEmail(payload.email);
      if (sub) matchedUserId = sub.user_id;
    }
    if (matchedUserId) {
      await activateFromPayment(matchedUserId, payload.email, new Date(payload.timestamp));
    }
  }

  await pool.query(
    `INSERT INTO kofi_events (
       kofi_transaction_id, message_id, type, is_subscription_payment, is_first_subscription_payment,
       from_name, email, amount, currency, message, tier_name, kofi_timestamp, matched_user_id, raw_payload
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      payload.kofi_transaction_id,
      payload.message_id,
      payload.type,
      payload.is_subscription_payment,
      payload.is_first_subscription_payment,
      payload.from_name,
      payload.email || null,
      payload.amount,
      payload.currency,
      payload.message || null,
      payload.tier_name,
      payload.timestamp,
      matchedUserId,
      JSON.stringify(payload),
    ]
  );

  return { matchedUserId, alreadyProcessed: false };
}

export async function listAllWithUser(): Promise<SubscriptionEntry[]> {
  const { rows } = await pool.query<SubscriptionEntry>(
    `SELECT s.*, u.username, u.avatar_url
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     ORDER BY (s.status = 'active' AND s.current_period_end > NOW()) DESC,
              s.current_period_end DESC NULLS LAST`
  );
  return rows;
}

/**
 * Ne remonte que les paiements de type éligible (don ou abonnement) qui
 * n'ont pas pu être rattachés — un Shop Order/Commission non rattaché n'est
 * pas une erreur à corriger, il n'a simplement jamais été éligible.
 */
export async function listUnmatchedEvents(limit = 50): Promise<KofiEventRow[]> {
  const { rows } = await pool.query<KofiEventRow>(
    `SELECT * FROM kofi_events
     WHERE matched_user_id IS NULL
       AND (is_subscription_payment = true OR type = 'Donation')
     ORDER BY received_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

/** Rattache manuellement un paiement Ko-fi non résolu (code de liaison absent/mal recopié). */
export async function matchEvent(eventId: number, userId: number): Promise<SubscriptionRow> {
  const { rows: eventRows } = await pool.query<KofiEventRow>(
    'SELECT * FROM kofi_events WHERE id = $1',
    [eventId]
  );
  const event = eventRows[0];
  if (!event) {
    throw Object.assign(new Error('Paiement Ko-fi introuvable'), { status: 404 });
  }
  if (event.matched_user_id) {
    throw Object.assign(new Error('Ce paiement est déjà rattaché à un compte'), { status: 409 });
  }

  await getOrCreateForUser(userId);
  const sub = await activateFromPayment(userId, event.email ?? '', new Date(event.kofi_timestamp));
  await pool.query('UPDATE kofi_events SET matched_user_id = $1 WHERE id = $2', [userId, eventId]);
  return sub;
}

interface AdminSetStatusInput {
  status: 'active' | 'inactive';
  currentPeriodEnd: Date | null;
}

/** Activation/prolongation/révocation manuelle par le MSP (ex: paiement vérifié à l'œil sur Ko-fi). */
export async function adminSetStatus(
  userId: number,
  { status, currentPeriodEnd }: AdminSetStatusInput,
  adminId: number
): Promise<SubscriptionRow> {
  await getOrCreateForUser(userId);
  const { rows } = await pool.query<SubscriptionRow>(
    `UPDATE subscriptions
     SET status = $1, current_period_end = $2, activated_by = $3, updated_at = NOW()
     WHERE user_id = $4
     RETURNING *`,
    [status, currentPeriodEnd, adminId, userId]
  );
  return rows[0] as SubscriptionRow;
}
