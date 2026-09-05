import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import * as spService from './sp.service.js';
import * as configService from './config.service.js';
import * as seasonService from './season.service.js';
import * as cosmeticsService from './cosmetics.service.js';
import type {
  AuctionBidEntry,
  AuctionBidRow,
  CosmeticAuctionDetail,
  CosmeticAuctionEntry,
  CosmeticAuctionRow,
} from '../types.js';

interface AuctionJoinRow extends CosmeticAuctionRow {
  cosmetic_json: string;
  seller_username: string;
  current_bidder_username: string | null;
  bid_count: string;
}

const ENTRY_SELECT = `
  SELECT a.*,
    row_to_json(c.*) AS cosmetic_json,
    seller.username AS seller_username,
    bidder.username AS current_bidder_username,
    (SELECT COUNT(*) FROM cosmetic_auction_bids b WHERE b.auction_id = a.id) AS bid_count
  FROM cosmetic_auctions a
  JOIN cosmetics c ON c.id = a.cosmetic_id
  JOIN users seller ON seller.id = a.seller_id
  LEFT JOIN users bidder ON bidder.id = a.current_bidder_id
`;

type EntryWithoutCosmetics = Omit<
  CosmeticAuctionEntry,
  'seller_equipped_cosmetics' | 'current_bidder_equipped_cosmetics'
>;

function toEntry(row: AuctionJoinRow): EntryWithoutCosmetics {
  const { cosmetic_json, seller_username, current_bidder_username, bid_count, ...auction } = row;
  return {
    ...auction,
    cosmetic: typeof cosmetic_json === 'string' ? JSON.parse(cosmetic_json) : cosmetic_json,
    seller_username,
    current_bidder_username,
    bid_count: Number(bid_count),
  };
}

/** Fusionne les cosmétiques équipés du vendeur et de l'enchérisseur actuel sur un lot d'enchères. */
async function withParticipantCosmetics(
  entries: EntryWithoutCosmetics[]
): Promise<CosmeticAuctionEntry[]> {
  const userIds = [
    ...new Set(
      entries.flatMap((e) => (e.current_bidder_id ? [e.seller_id, e.current_bidder_id] : [e.seller_id]))
    ),
  ];
  const equippedByUser = await cosmeticsService.getEquippedForUsers(userIds);
  return entries.map((e) => ({
    ...e,
    seller_equipped_cosmetics: equippedByUser.get(e.seller_id) ?? [],
    current_bidder_equipped_cosmetics: e.current_bidder_id
      ? equippedByUser.get(e.current_bidder_id) ?? []
      : [],
  }));
}

/**
 * Résout une enchère dont le terme est dépassé : transfère le cosmétique et
 * le SP au vainqueur s'il y a une offre, sinon la marque simplement expirée.
 * Appelée à l'intérieur d'une transaction déjà ouverte par l'appelant
 * (expireStaleAuctions ou placeBid quand l'enchère consultée vient de finir).
 */
async function resolveAuction(
  client: PoolClient,
  auction: CosmeticAuctionRow
): Promise<ResolvedAuctionInfo> {
  if (auction.current_bidder_id !== null && auction.current_bid !== null) {
    const season = await seasonService.getActiveSeason();
    await spService.creditSP({
      userId: auction.seller_id,
      amount: auction.current_bid,
      type: 'auction_sale',
      seasonId: season?.id ?? null,
      relatedId: auction.id,
      note: `Vente aux enchères #${auction.id}`,
      affectsTotalEarned: true,
      client,
    });
    await client.query(
      `UPDATE cosmetic_auction_bids SET status = 'won'
       WHERE auction_id = $1 AND bidder_id = $2 AND status = 'active'`,
      [auction.id, auction.current_bidder_id]
    );
    await cosmeticsService.consumeOneCopy(auction.seller_id, auction.cosmetic_id, client);
    await cosmeticsService.grant(auction.current_bidder_id, auction.cosmetic_id, 'auction', client);
    await client.query(
      `UPDATE cosmetic_auctions SET status = 'sold', resolved_at = NOW() WHERE id = $1`,
      [auction.id]
    );
    return {
      auctionId: auction.id,
      cosmeticId: auction.cosmetic_id,
      sellerId: auction.seller_id,
      buyerId: auction.current_bidder_id,
      amount: auction.current_bid,
    };
  }

  await client.query(
    `UPDATE cosmetic_auctions SET status = 'expired', resolved_at = NOW() WHERE id = $1`,
    [auction.id]
  );
  return {
    auctionId: auction.id,
    cosmeticId: auction.cosmetic_id,
    sellerId: auction.seller_id,
    buyerId: null,
    amount: null,
  };
}

export interface ResolvedAuctionInfo {
  auctionId: number;
  cosmeticId: number;
  sellerId: number;
  buyerId: number | null;
  amount: number | null;
}

/** Résolution paresseuse (check à la lecture) — même pattern que challenge.service.ts#expirePendingChallenges. */
export async function expireStaleAuctions(): Promise<ResolvedAuctionInfo[]> {
  const client = await pool.connect();
  const results: ResolvedAuctionInfo[] = [];
  try {
    await client.query('BEGIN');
    const { rows: stale } = await client.query<CosmeticAuctionRow>(
      `SELECT * FROM cosmetic_auctions WHERE status = 'active' AND ends_at < NOW() FOR UPDATE`
    );
    for (const auction of stale) {
      results.push(await resolveAuction(client, auction));
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

/** Ne résout pas les enchères expirées elle-même — l'appelant (contrôleur) doit
 * appeler `expireStaleAuctions()` juste avant pour pouvoir notifier les
 * enchères qu'il vient de clôturer (même découplage que challenges.controller
 * avec `expirePendingChallenges`). */
export async function listActiveAuctions(): Promise<CosmeticAuctionEntry[]> {
  const { rows } = await pool.query<AuctionJoinRow>(
    `${ENTRY_SELECT} WHERE a.status = 'active' ORDER BY a.ends_at ASC`
  );
  return withParticipantCosmetics(rows.map(toEntry));
}

export async function getAuctionById(id: number): Promise<CosmeticAuctionDetail | null> {
  const { rows } = await pool.query<AuctionJoinRow>(`${ENTRY_SELECT} WHERE a.id = $1`, [id]);
  const row = rows[0];
  if (!row) return null;

  const { rows: bidRows } = await pool.query<Omit<AuctionBidEntry, 'bidder_equipped_cosmetics'>>(
    `SELECT b.*, u.username AS bidder_username
     FROM cosmetic_auction_bids b
     JOIN users u ON u.id = b.bidder_id
     WHERE b.auction_id = $1
     ORDER BY b.created_at DESC`,
    [id]
  );
  const bidderCosmetics = await cosmeticsService.getEquippedForUsers(bidRows.map((b) => b.bidder_id));
  const bids: AuctionBidEntry[] = bidRows.map((b) => ({
    ...b,
    bidder_equipped_cosmetics: bidderCosmetics.get(b.bidder_id) ?? [],
  }));

  const [entry] = await withParticipantCosmetics([toEntry(row)]);
  return { ...(entry as CosmeticAuctionEntry), bids };
}

export async function getMyActivity(
  userId: number
): Promise<{ selling: CosmeticAuctionEntry[]; bidding: CosmeticAuctionEntry[] }> {
  const { rows: sellingRows } = await pool.query<AuctionJoinRow>(
    `${ENTRY_SELECT} WHERE a.seller_id = $1 ORDER BY a.created_at DESC`,
    [userId]
  );
  const { rows: biddingRows } = await pool.query<AuctionJoinRow>(
    `${ENTRY_SELECT}
     WHERE a.id IN (SELECT DISTINCT auction_id FROM cosmetic_auction_bids WHERE bidder_id = $1)
     ORDER BY a.created_at DESC`,
    [userId]
  );
  const [selling, bidding] = await Promise.all([
    withParticipantCosmetics(sellingRows.map(toEntry)),
    withParticipantCosmetics(biddingRows.map(toEntry)),
  ]);
  return { selling, bidding };
}

export async function createAuction(
  sellerId: number,
  cosmeticId: number,
  startingPrice: number,
  durationMinutes: number
): Promise<CosmeticAuctionRow> {
  const cosmetic = await cosmeticsService.getCosmeticById(cosmeticId);
  if (!cosmetic) {
    throw Object.assign(new Error('Cosmétique introuvable'), { status: 404 });
  }
  if (cosmetic.is_default) {
    throw Object.assign(new Error('Ce cosmétique est un défaut, il ne peut pas être vendu'), {
      status: 409,
    });
  }
  if (startingPrice <= 0) {
    throw Object.assign(new Error('Le prix de départ doit être positif'), { status: 400 });
  }

  const minMinutes = await configService.getConfigNumber('auction_min_duration_minutes', 5);
  const maxMinutes = await configService.getConfigNumber('auction_max_duration_minutes', 4320);
  if (durationMinutes < minMinutes || durationMinutes > maxMinutes) {
    throw Object.assign(
      new Error(`La durée doit être comprise entre ${minMinutes} et ${maxMinutes} minutes`),
      { status: 400 }
    );
  }

  const { rows: ownedRows } = await pool.query<{ quantity: number }>(
    'SELECT quantity FROM user_cosmetics WHERE user_id = $1 AND cosmetic_id = $2',
    [sellerId, cosmeticId]
  );
  const owned = ownedRows[0]?.quantity ?? 0;

  const { rows: listedRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM cosmetic_auctions WHERE seller_id = $1 AND cosmetic_id = $2 AND status = 'active'`,
    [sellerId, cosmeticId]
  );
  const alreadyListed = Number(listedRows[0]?.count ?? 0);

  if (owned - alreadyListed < 1) {
    throw Object.assign(
      new Error('Tu n\'as pas d\'exemplaire disponible de ce cosmétique (déjà en enchère ou non possédé)'),
      { status: 409 }
    );
  }

  const { rows } = await pool.query<CosmeticAuctionRow>(
    `INSERT INTO cosmetic_auctions (seller_id, cosmetic_id, starting_price, ends_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval)
     RETURNING *`,
    [sellerId, cosmeticId, startingPrice, durationMinutes]
  );
  return rows[0] as CosmeticAuctionRow;
}

export interface PlaceBidResult {
  auction: CosmeticAuctionRow;
  previousBidderId: number | null;
}

export async function placeBid(
  auctionId: number,
  bidderId: number,
  amount: number
): Promise<PlaceBidResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<CosmeticAuctionRow>(
      'SELECT * FROM cosmetic_auctions WHERE id = $1 FOR UPDATE',
      [auctionId]
    );
    const auction = rows[0];
    if (!auction) {
      throw Object.assign(new Error('Enchère introuvable'), { status: 404 });
    }

    if (auction.status === 'active' && new Date(auction.ends_at).getTime() < Date.now()) {
      await resolveAuction(client, auction);
      throw Object.assign(new Error('Cette enchère est terminée'), { status: 409 });
    }
    if (auction.status !== 'active') {
      throw Object.assign(new Error('Cette enchère n\'est plus active'), { status: 409 });
    }
    if (auction.seller_id === bidderId) {
      throw Object.assign(new Error('Tu ne peux pas enchérir sur ta propre enchère'), {
        status: 400,
      });
    }

    const minIncrement = await configService.getConfigNumber('auction_min_bid_increment', 1);
    const minRequired =
      auction.current_bid !== null ? auction.current_bid + minIncrement : auction.starting_price;
    if (amount < minRequired) {
      throw Object.assign(new Error(`L'offre minimale est de ${minRequired} SP`), { status: 400 });
    }

    const season = await seasonService.getActiveSeason();

    const holdTx = await spService.debitSP({
      userId: bidderId,
      amount,
      type: 'auction_bid_hold',
      seasonId: season?.id ?? null,
      relatedId: auctionId,
      note: `Offre sur l'enchère #${auctionId}`,
      client,
    });

    const previousBidderId = auction.current_bidder_id;
    if (previousBidderId !== null && auction.current_bid !== null) {
      const refundTx = await spService.creditSP({
        userId: previousBidderId,
        amount: auction.current_bid,
        type: 'auction_bid_refund',
        seasonId: season?.id ?? null,
        relatedId: auctionId,
        note: `Remboursement — surenchéri sur l'enchère #${auctionId}`,
        affectsTotalEarned: false,
        client,
      });
      await client.query(
        `UPDATE cosmetic_auction_bids SET status = 'refunded', refund_transaction_id = $1
         WHERE auction_id = $2 AND status = 'active'`,
        [refundTx.id, auctionId]
      );
    }

    await client.query(
      `INSERT INTO cosmetic_auction_bids (auction_id, bidder_id, amount, status, hold_transaction_id)
       VALUES ($1, $2, $3, 'active', $4)`,
      [auctionId, bidderId, amount, holdTx.id]
    );

    const { rows: updatedRows } = await client.query<CosmeticAuctionRow>(
      `UPDATE cosmetic_auctions SET current_bid = $1, current_bidder_id = $2 WHERE id = $3 RETURNING *`,
      [amount, bidderId, auctionId]
    );

    await client.query('COMMIT');
    return { auction: updatedRows[0] as CosmeticAuctionRow, previousBidderId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface CancelAuctionResult {
  auction: CosmeticAuctionRow;
  refundedBidderId: number | null;
}

export async function cancelAuction(auctionId: number, adminId: number): Promise<CancelAuctionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<CosmeticAuctionRow>(
      'SELECT * FROM cosmetic_auctions WHERE id = $1 FOR UPDATE',
      [auctionId]
    );
    const auction = rows[0];
    if (!auction) {
      throw Object.assign(new Error('Enchère introuvable'), { status: 404 });
    }
    if (auction.status !== 'active') {
      throw Object.assign(new Error('Cette enchère ne peut plus être annulée'), { status: 400 });
    }

    let refundedBidderId: number | null = null;
    if (auction.current_bidder_id !== null && auction.current_bid !== null) {
      const season = await seasonService.getActiveSeason();
      const refundTx = await spService.creditSP({
        userId: auction.current_bidder_id,
        amount: auction.current_bid,
        type: 'auction_bid_refund',
        seasonId: season?.id ?? null,
        relatedId: auctionId,
        note: `Remboursement — enchère #${auctionId} annulée par le MSP`,
        affectsTotalEarned: false,
        client,
      });
      await client.query(
        `UPDATE cosmetic_auction_bids SET status = 'refunded', refund_transaction_id = $1
         WHERE auction_id = $2 AND status = 'active'`,
        [refundTx.id, auctionId]
      );
      refundedBidderId = auction.current_bidder_id;
    }

    const { rows: updatedRows } = await client.query<CosmeticAuctionRow>(
      `UPDATE cosmetic_auctions SET status = 'cancelled', cancelled_by = $1, cancelled_at = NOW()
       WHERE id = $2 RETURNING *`,
      [adminId, auctionId]
    );

    await client.query('COMMIT');
    return { auction: updatedRows[0] as CosmeticAuctionRow, refundedBidderId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
