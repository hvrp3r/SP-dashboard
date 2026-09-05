import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as configService from './config.service.js';
import * as cosmeticsService from './cosmetics.service.js';
import { startOfDayLocalAsUTC } from '../utils/localDate.js';
import * as engine from './blackjackEngine.js';
import type {
  BlackjackActionResult,
  BlackjackCard,
  BlackjackHandEntry,
  BlackjackHandRow,
  BlackjackHistoryEntry,
  BlackjackOutcome,
  BlackjackSessionPublicView,
  BlackjackSessionRow,
} from '../types.js';

const MAX_SEATS = 8;
const JOIN_WINDOW_SECONDS = 15;
const ACTION_TIMEOUT_SECONDS = 20;
/** Délai pendant lequel une table `finished` reste affichée avant qu'une nouvelle `waiting` la remplace. */
const RESULTS_DISPLAY_SECONDS = 6;

/**
 * Taux de redistribution théorique du blackjack, à stratégie optimale simple
 * (hit/stand only — pas de double/split ici, donc pas de vraie "basic strategy"
 * classique). Simulation à 3M mains avec seuils de stand optimisés par carte
 * visible du croupier : ~96.3% de RTP. Constante fixe (contrairement aux
 * caisses, les règles du blackjack ne sont pas configurables par le MSP) —
 * arrondie à l'entier inférieur pour rester une annonce prudente vis-à-vis des
 * joueurs qui ne jouent pas la stratégie optimale.
 */
export const BLACKJACK_RTP_PERCENT = 96;

function isOlderThan(ts: string | null, seconds: number): boolean {
  if (!ts) return true;
  return Date.now() - new Date(ts).getTime() > seconds * 1000;
}

function toPublicView(
  session: BlackjackSessionRow,
  hands: BlackjackHandEntry[]
): BlackjackSessionPublicView {
  const dealerCards: (BlackjackCard | null)[] = session.dealer_hole_revealed
    ? session.dealer_cards
    : session.dealer_cards.map((c, i) => (i === 0 ? c : null));
  return { ...session, dealer_cards: dealerCards, hands };
}

async function getLatestSessionRow(seasonId: number | null): Promise<BlackjackSessionRow | null> {
  const { rows } = await pool.query<BlackjackSessionRow>(
    `SELECT * FROM blackjack_sessions
     WHERE season_id IS NOT DISTINCT FROM $1
     ORDER BY created_at DESC LIMIT 1`,
    [seasonId]
  );
  return rows[0] ?? null;
}

async function createSession(seasonId: number | null): Promise<BlackjackSessionRow> {
  const { rows } = await pool.query<BlackjackSessionRow>(
    'INSERT INTO blackjack_sessions (season_id) VALUES ($1) RETURNING *',
    [seasonId]
  );
  return rows[0] as BlackjackSessionRow;
}

/** Interrupteur propre au blackjack (indépendant de `gambling_enabled`, qui ne gouverne que les caisses). */
async function isBlackjackEnabled(): Promise<boolean> {
  return configService.getConfigBool('blackjack_enabled', false);
}

async function getBalance(userId: number): Promise<number> {
  const { rows } = await pool.query<{ sp_balance: number }>(
    'SELECT sp_balance FROM users WHERE id = $1',
    [userId]
  );
  return rows[0]?.sp_balance ?? 0;
}

async function listHands(sessionId: number): Promise<BlackjackHandEntry[]> {
  const { rows } = await pool.query<Omit<BlackjackHandEntry, 'equipped_cosmetics'>>(
    `SELECT h.*, u.username, u.avatar_url
     FROM blackjack_hands h
     JOIN users u ON u.id = h.user_id
     WHERE h.session_id = $1
     ORDER BY h.joined_at ASC`,
    [sessionId]
  );
  const equippedByUser = await cosmeticsService.getEquippedForUsers(rows.map((r) => r.user_id));
  return rows.map((row) => ({
    ...row,
    equipped_cosmetics: equippedByUser.get(row.user_id) ?? [],
  }));
}

/**
 * Distribue 2 cartes à chaque main en attente + au croupier, verrouille les
 * mains à 21 naturel en `stood` (elles ne peuvent pas tirer davantage), passe
 * la session `active`, puis désigne le premier joueur à agir (tour par tour,
 * dans l'ordre d'arrivée — voir `moveToNextPlayableHand`).
 */
async function startRound(
  client: PoolClient,
  session: BlackjackSessionRow
): Promise<BlackjackSessionRow> {
  const { rows: hands } = await client.query<BlackjackHandRow>(
    'SELECT * FROM blackjack_hands WHERE session_id = $1 FOR UPDATE',
    [session.id]
  );

  const dealerCards: BlackjackCard[] = [engine.drawCard(), engine.drawCard()];

  for (const hand of hands) {
    const cards: BlackjackCard[] = [engine.drawCard(), engine.drawCard()];
    const status = engine.isBlackjack(cards) ? 'stood' : 'playing';
    await client.query('UPDATE blackjack_hands SET cards = $1, status = $2 WHERE id = $3', [
      JSON.stringify(cards),
      status,
      hand.id,
    ]);
  }

  const { rows } = await client.query<BlackjackSessionRow>(
    `UPDATE blackjack_sessions
     SET status = 'active', started_at = NOW(), dealer_cards = $1, current_hand_id = NULL
     WHERE id = $2 RETURNING *`,
    [JSON.stringify(dealerCards), session.id]
  );
  return moveToNextPlayableHand(client, rows[0] as BlackjackSessionRow);
}

/**
 * Avance `current_hand_id` vers la prochaine main `playing` après la main
 * courante, dans l'ordre d'arrivée (`joined_at`) — c'est le moteur du tour
 * par tour. Ne fait rien si la main courante est encore `playing` (toujours
 * son tour). Vide `current_hand_id` (NULL) s'il ne reste plus personne à
 * faire jouer : la manche est alors prête pour `resolveRound`.
 */
async function moveToNextPlayableHand(
  client: PoolClient,
  session: BlackjackSessionRow
): Promise<BlackjackSessionRow> {
  const { rows: hands } = await client.query<BlackjackHandRow>(
    'SELECT * FROM blackjack_hands WHERE session_id = $1 ORDER BY joined_at ASC',
    [session.id]
  );

  const currentIndex = hands.findIndex((h) => h.id === session.current_hand_id);
  const currentHand = currentIndex >= 0 ? hands[currentIndex] : null;
  if (currentHand && currentHand.status === 'playing') {
    return session;
  }

  const searchStart = currentIndex >= 0 ? currentIndex + 1 : 0;
  const next = hands.slice(searchStart).find((h) => h.status === 'playing') ?? null;

  if (next) {
    const actionDeadline = new Date(Date.now() + ACTION_TIMEOUT_SECONDS * 1000);
    await client.query('UPDATE blackjack_hands SET action_deadline = $1 WHERE id = $2', [
      actionDeadline,
      next.id,
    ]);
    const { rows } = await client.query<BlackjackSessionRow>(
      'UPDATE blackjack_sessions SET current_hand_id = $1 WHERE id = $2 RETURNING *',
      [next.id, session.id]
    );
    return rows[0] as BlackjackSessionRow;
  }

  const { rows } = await client.query<BlackjackSessionRow>(
    'UPDATE blackjack_sessions SET current_hand_id = NULL WHERE id = $1 RETURNING *',
    [session.id]
  );
  return rows[0] as BlackjackSessionRow;
}

/**
 * Le croupier tire jusqu'à >=17, révèle sa carte cachée, puis chaque main non
 * `busted` est comparée au croupier pour déterminer l'issue et créditer le gain
 * éventuel. Session passe `finished`.
 */
async function resolveRound(
  client: PoolClient,
  session: BlackjackSessionRow
): Promise<BlackjackSessionRow> {
  const { rows: hands } = await client.query<BlackjackHandRow>(
    'SELECT * FROM blackjack_hands WHERE session_id = $1 FOR UPDATE',
    [session.id]
  );

  let dealerCards = [...session.dealer_cards];
  while (engine.dealerShouldHit(dealerCards)) {
    dealerCards = [...dealerCards, engine.drawCard()];
  }
  const dealerTotal = engine.handTotal(dealerCards);
  const dealerBlackjack = engine.isBlackjack(dealerCards);

  for (const hand of hands) {
    let outcome: BlackjackOutcome;
    if (hand.status === 'busted') {
      outcome = 'lose';
    } else {
      const playerBlackjack = engine.isBlackjack(hand.cards);
      const playerTotal = engine.handTotal(hand.cards);
      if (playerBlackjack && dealerBlackjack) outcome = 'push';
      else if (playerBlackjack) outcome = 'blackjack';
      else if (dealerBlackjack) outcome = 'lose';
      else if (dealerTotal > 21) outcome = 'win';
      else if (playerTotal > dealerTotal) outcome = 'win';
      else if (playerTotal === dealerTotal) outcome = 'push';
      else outcome = 'lose';
    }

    let payoutTransactionId: number | null = null;
    if (outcome !== 'lose') {
      // SP toujours en entier : le 3:2 du blackjack naturel est arrondi à l'entier inférieur.
      const payout =
        outcome === 'blackjack'
          ? hand.bet_amount + Math.floor(hand.bet_amount * 1.5)
          : outcome === 'push'
            ? hand.bet_amount
            : hand.bet_amount * 2;
      const label =
        outcome === 'blackjack' ? 'Blackjack naturel' : outcome === 'push' ? 'Égalité' : 'Victoire';
      const tx = await spService.creditSP({
        userId: hand.user_id,
        amount: payout,
        type: 'gambling_win',
        seasonId: session.season_id,
        relatedId: hand.id,
        note: `Blackjack — ${label} (mise ${hand.bet_amount} SP)`,
        client,
      });
      payoutTransactionId = tx.id;
    }

    await client.query(
      'UPDATE blackjack_hands SET outcome = $1, payout_transaction_id = $2, resolved_at = NOW() WHERE id = $3',
      [outcome, payoutTransactionId, hand.id]
    );
  }

  const { rows } = await client.query<BlackjackSessionRow>(
    `UPDATE blackjack_sessions
     SET status = 'finished', finished_at = NOW(), dealer_cards = $1, dealer_hole_revealed = TRUE
     WHERE id = $2 RETURNING *`,
    [JSON.stringify(dealerCards), session.id]
  );
  return rows[0] as BlackjackSessionRow;
}

/**
 * Avance l'état de la session si le temps est écoulé : démarrage (waiting -> active)
 * une fois `starts_at` dépassé, auto-stand de la main courante si son délai de
 * décision est dépassé (une seule main a un délai actif à la fois — tour par
 * tour), avance du tour au joueur suivant, puis résolution (active -> finished)
 * dès qu'il ne reste plus personne à faire jouer. Appelée avec une session déjà
 * verrouillée (`FOR UPDATE`) par l'appelant.
 */
async function advanceSession(
  client: PoolClient,
  session: BlackjackSessionRow
): Promise<BlackjackSessionRow> {
  let current = session;

  if (current.status === 'waiting' && current.starts_at && new Date(current.starts_at) <= new Date()) {
    current = await startRound(client, current);
  }

  if (current.status === 'active') {
    if (current.current_hand_id) {
      const { rows } = await client.query<BlackjackHandRow>(
        'SELECT * FROM blackjack_hands WHERE id = $1 FOR UPDATE',
        [current.current_hand_id]
      );
      const currentHand = rows[0];
      if (
        currentHand &&
        currentHand.status === 'playing' &&
        currentHand.action_deadline &&
        new Date(currentHand.action_deadline) < new Date()
      ) {
        await client.query(`UPDATE blackjack_hands SET status = 'stood' WHERE id = $1`, [
          currentHand.id,
        ]);
      }
    }

    current = await moveToNextPlayableHand(client, current);

    if (current.status === 'active' && current.current_hand_id === null) {
      current = await resolveRound(client, current);
    }
  }

  return current;
}

async function syncSession(sessionId: number): Promise<BlackjackSessionRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<BlackjackSessionRow>(
      'SELECT * FROM blackjack_sessions WHERE id = $1 FOR UPDATE',
      [sessionId]
    );
    let session = rows[0];
    if (!session) {
      throw Object.assign(new Error('Session introuvable'), { status: 404 });
    }
    session = await advanceSession(client, session);
    await client.query('COMMIT');
    return session;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getCurrentSessionView(
  userId: number,
  seasonId: number | null
): Promise<BlackjackActionResult> {
  let latest = await getLatestSessionRow(seasonId);
  if (!latest || (latest.status === 'finished' && isOlderThan(latest.finished_at, RESULTS_DISPLAY_SECONDS))) {
    latest = await createSession(seasonId);
  }

  const session = await syncSession(latest.id);
  const hands = await listHands(session.id);
  const [balance, enabled] = await Promise.all([getBalance(userId), isBlackjackEnabled()]);
  return { session: toPublicView(session, hands), balance, enabled };
}

/**
 * Rejoint la table courante avec une mise. Pas de `sessionId` en entrée : le
 * serveur résout toujours "la" session courante lui-même, pour éviter qu'un
 * client rejoigne une table déjà périmée côté UI.
 */
export async function joinSession(
  userId: number,
  betAmount: number,
  seasonId: number | null
): Promise<BlackjackActionResult> {
  const enabled = await isBlackjackEnabled();
  if (!enabled) {
    throw Object.assign(new Error('Le blackjack est désactivé par le MSP'), { status: 403 });
  }
  const maxWagerPerDay = await configService.getConfigNumber('gambling_max_wager_per_day', 50);

  let latest = await getLatestSessionRow(seasonId);
  if (!latest || (latest.status === 'finished' && isOlderThan(latest.finished_at, RESULTS_DISPLAY_SECONDS))) {
    latest = await createSession(seasonId);
  }
  latest = await syncSession(latest.id);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

    const { rows: sessionRows } = await client.query<BlackjackSessionRow>(
      'SELECT * FROM blackjack_sessions WHERE id = $1 FOR UPDATE',
      [latest.id]
    );
    const session = sessionRows[0];
    if (!session || session.status !== 'waiting') {
      throw Object.assign(
        new Error('La partie a déjà démarré, réessaie à la prochaine table'),
        { status: 409 }
      );
    }

    const { rows: countRows } = await client.query<{ count: string }>(
      'SELECT COUNT(*) FROM blackjack_hands WHERE session_id = $1',
      [session.id]
    );
    const seatCount = Number(countRows[0]?.count ?? 0);
    if (seatCount >= MAX_SEATS) {
      throw Object.assign(new Error(`La table est complète (${MAX_SEATS} joueurs max)`), {
        status: 400,
      });
    }

    const { rows: existingRows } = await client.query(
      'SELECT id FROM blackjack_hands WHERE session_id = $1 AND user_id = $2',
      [session.id, userId]
    );
    if (existingRows.length > 0) {
      throw Object.assign(new Error('Tu es déjà à cette table'), { status: 400 });
    }

    const { rows: spentRows } = await client.query<{ spent: string | null }>(
      `SELECT SUM(-amount) AS spent FROM sp_transactions
       WHERE user_id = $1 AND type = 'gambling_spend' AND created_at >= $2`,
      [userId, startOfDayLocalAsUTC()]
    );
    const spentToday = Number(spentRows[0]?.spent ?? 0);
    if (spentToday + betAmount > maxWagerPerDay) {
      throw Object.assign(
        new Error(
          `Budget gambling quotidien dépassé (${spentToday}/${maxWagerPerDay} SP déjà misés aujourd'hui)`
        ),
        { status: 400 }
      );
    }

    const { rows: handRows } = await client.query<BlackjackHandRow>(
      'INSERT INTO blackjack_hands (session_id, user_id, bet_amount) VALUES ($1, $2, $3) RETURNING *',
      [session.id, userId, betAmount]
    );
    const hand = handRows[0] as BlackjackHandRow;

    const betTx = await spService.debitSP({
      userId,
      amount: betAmount,
      type: 'gambling_spend',
      seasonId: session.season_id,
      relatedId: hand.id,
      note: `Mise blackjack (${betAmount} SP)`,
      client,
    });
    await client.query('UPDATE blackjack_hands SET bet_transaction_id = $1 WHERE id = $2', [
      betTx.id,
      hand.id,
    ]);

    let updatedSession = session;
    if (seatCount === 0) {
      const { rows: startRows } = await client.query<BlackjackSessionRow>(
        `UPDATE blackjack_sessions SET starts_at = NOW() + ($1 || ' seconds')::interval WHERE id = $2 RETURNING *`,
        [String(JOIN_WINDOW_SECONDS), session.id]
      );
      updatedSession = startRows[0] as BlackjackSessionRow;
    }

    const { rows: balanceRows } = await client.query<{ sp_balance: number }>(
      'SELECT sp_balance FROM users WHERE id = $1',
      [userId]
    );
    const balance = balanceRows[0]?.sp_balance ?? 0;

    await client.query('COMMIT');

    const hands = await listHands(updatedSession.id);
    return { session: toPublicView(updatedSession, hands), balance, enabled };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function findMyPlayingHand(
  client: PoolClient,
  userId: number,
  seasonId: number | null
): Promise<{ session: BlackjackSessionRow; hand: BlackjackHandRow }> {
  const latest = await getLatestSessionRow(seasonId);
  if (!latest) {
    throw Object.assign(new Error('Aucune partie en cours'), { status: 404 });
  }

  const { rows: sessionRows } = await client.query<BlackjackSessionRow>(
    'SELECT * FROM blackjack_sessions WHERE id = $1 FOR UPDATE',
    [latest.id]
  );
  const session = sessionRows[0];
  if (!session || session.status !== 'active') {
    throw Object.assign(new Error("Ce n'est pas le moment de jouer"), { status: 409 });
  }

  const { rows: handRows } = await client.query<BlackjackHandRow>(
    'SELECT * FROM blackjack_hands WHERE session_id = $1 AND user_id = $2 FOR UPDATE',
    [session.id, userId]
  );
  const hand = handRows[0];
  if (!hand) {
    throw Object.assign(new Error("Tu n'as pas de main à cette table"), { status: 404 });
  }
  if (hand.id !== session.current_hand_id) {
    throw Object.assign(new Error("Ce n'est pas ton tour"), { status: 409 });
  }
  if (hand.status !== 'playing') {
    throw Object.assign(new Error('Ta main est déjà terminée'), { status: 409 });
  }
  if (hand.action_deadline && new Date(hand.action_deadline) < new Date()) {
    throw Object.assign(new Error('Le délai pour jouer est dépassé'), { status: 409 });
  }

  return { session, hand };
}

export async function hit(
  userId: number,
  seasonId: number | null
): Promise<BlackjackActionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { session, hand } = await findMyPlayingHand(client, userId, seasonId);

    const cards = [...hand.cards, engine.drawCard()];
    const status = engine.isBust(cards) ? 'busted' : engine.handTotal(cards) === 21 ? 'stood' : 'playing';
    await client.query('UPDATE blackjack_hands SET cards = $1, status = $2 WHERE id = $3', [
      JSON.stringify(cards),
      status,
      hand.id,
    ]);

    const updatedSession = await advanceSession(client, session);
    const { rows: balanceRows } = await client.query<{ sp_balance: number }>(
      'SELECT sp_balance FROM users WHERE id = $1',
      [userId]
    );
    const balance = balanceRows[0]?.sp_balance ?? 0;
    await client.query('COMMIT');

    const hands = await listHands(updatedSession.id);
    const enabled = await isBlackjackEnabled();
    return { session: toPublicView(updatedSession, hands), balance, enabled };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function stand(
  userId: number,
  seasonId: number | null
): Promise<BlackjackActionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { session, hand } = await findMyPlayingHand(client, userId, seasonId);

    await client.query(`UPDATE blackjack_hands SET status = 'stood' WHERE id = $1`, [hand.id]);

    const updatedSession = await advanceSession(client, session);
    const { rows: balanceRows } = await client.query<{ sp_balance: number }>(
      'SELECT sp_balance FROM users WHERE id = $1',
      [userId]
    );
    const balance = balanceRows[0]?.sp_balance ?? 0;
    await client.query('COMMIT');

    const hands = await listHands(updatedSession.id);
    const enabled = await isBlackjackEnabled();
    return { session: toPublicView(updatedSession, hands), balance, enabled };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listMyHistory(userId: number, limit: number): Promise<BlackjackHistoryEntry[]> {
  const { rows } = await pool.query<BlackjackHistoryEntry>(
    `SELECT h.id, h.session_id, h.bet_amount, h.cards, h.status, h.outcome, h.resolved_at,
            s.dealer_cards
     FROM blackjack_hands h
     JOIN blackjack_sessions s ON s.id = h.session_id
     WHERE h.user_id = $1 AND h.outcome IS NOT NULL
     ORDER BY h.resolved_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}
