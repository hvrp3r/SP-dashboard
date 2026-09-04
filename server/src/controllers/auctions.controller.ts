import type { Request, Response } from 'express';
import * as auctionService from '../services/auction.service.js';
import * as cosmeticsService from '../services/cosmetics.service.js';
import * as notificationService from '../services/notification.service.js';
import type { ResolvedAuctionInfo } from '../services/auction.service.js';

async function notifyResolved(resolved: ResolvedAuctionInfo[]): Promise<void> {
  await Promise.all(
    resolved.map(async (r) => {
      const cosmetic = await cosmeticsService.getCosmeticById(r.cosmeticId);
      const name = cosmetic?.name ?? 'ton cosmétique';
      if (r.buyerId !== null) {
        await Promise.all([
          notificationService.createNotification({
            userId: r.sellerId,
            type: 'auction_sold',
            message: `Ton enchère « ${name} » a été vendue pour ${r.amount} SP !`,
            link: `/encheres/${r.auctionId}`,
          }),
          notificationService.createNotification({
            userId: r.buyerId,
            type: 'auction_won',
            message: `Tu as remporté l'enchère « ${name} » pour ${r.amount} SP !`,
            link: `/encheres/${r.auctionId}`,
          }),
        ]);
      } else {
        await notificationService.createNotification({
          userId: r.sellerId,
          type: 'auction_expired',
          message: `Ton enchère « ${name} » a expiré sans offre`,
          link: `/encheres/${r.auctionId}`,
        });
      }
    })
  );
}

export async function listActive(req: Request, res: Response): Promise<void> {
  const resolved = await auctionService.expireStaleAuctions();
  await notifyResolved(resolved);
  const auctions = await auctionService.listActiveAuctions();
  res.json(auctions);
}

export async function getMyActivity(req: Request, res: Response): Promise<void> {
  const resolved = await auctionService.expireStaleAuctions();
  await notifyResolved(resolved);
  const activity = await auctionService.getMyActivity(req.user!.id);
  res.json(activity);
}

export async function getById(req: Request<{ id: string }>, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }
  const resolved = await auctionService.expireStaleAuctions();
  await notifyResolved(resolved.filter((r) => r.auctionId === id));
  const auction = await auctionService.getAuctionById(id);
  if (!auction) {
    res.status(404).json({ error: 'Enchère introuvable' });
    return;
  }
  res.json(auction);
}

interface CreateAuctionBody {
  cosmeticId?: number;
  startingPrice?: number;
  durationMinutes?: number;
}

export async function create(req: Request<{}, {}, CreateAuctionBody>, res: Response): Promise<void> {
  const cosmeticId = req.body?.cosmeticId;
  const startingPrice = req.body?.startingPrice;
  const durationMinutes = req.body?.durationMinutes;
  if (!Number.isInteger(cosmeticId) || !Number.isInteger(startingPrice) || !Number.isInteger(durationMinutes)) {
    res.status(400).json({ error: 'Cosmétique, prix de départ et durée requis' });
    return;
  }

  try {
    const auction = await auctionService.createAuction(
      req.user!.id,
      cosmeticId as number,
      startingPrice as number,
      durationMinutes as number
    );
    res.status(201).json(auction);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
  }
}

interface PlaceBidBody {
  amount?: number;
}

export async function placeBid(
  req: Request<{ id: string }, {}, PlaceBidBody>,
  res: Response
): Promise<void> {
  const auctionId = Number(req.params.id);
  const amount = req.body?.amount;
  if (!Number.isInteger(auctionId) || !Number.isInteger(amount) || (amount as number) <= 0) {
    res.status(400).json({ error: 'Montant d\'offre invalide' });
    return;
  }

  try {
    const result = await auctionService.placeBid(auctionId, req.user!.id, amount as number);
    if (result.previousBidderId !== null) {
      const auction = await auctionService.getAuctionById(auctionId);
      await notificationService.createNotification({
        userId: result.previousBidderId,
        type: 'auction_outbid',
        message: `Tu as été surenchéri sur « ${auction?.cosmetic.name ?? 'un cosmétique'} »`,
        link: `/encheres/${auctionId}`,
      });
    }
    res.status(201).json(result.auction);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
  }
}

export async function cancel(req: Request<{ id: string }>, res: Response): Promise<void> {
  const auctionId = Number(req.params.id);
  if (!Number.isInteger(auctionId)) {
    res.status(400).json({ error: 'Identifiant invalide' });
    return;
  }

  try {
    const result = await auctionService.cancelAuction(auctionId, req.user!.id);
    const cosmetic = await cosmeticsService.getCosmeticById(result.auction.cosmetic_id);
    const name = cosmetic?.name ?? 'ton cosmétique';
    await notificationService.createNotification({
      userId: result.auction.seller_id,
      type: 'auction_cancelled',
      message: `Le MSP a annulé ton enchère « ${name} »`,
      link: `/encheres/${auctionId}`,
    });
    if (result.refundedBidderId !== null) {
      await notificationService.createNotification({
        userId: result.refundedBidderId,
        type: 'auction_cancelled',
        message: `Le MSP a annulé l'enchère « ${name} » — ton offre a été remboursée`,
        link: `/encheres/${auctionId}`,
      });
    }
    res.json(result.auction);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
  }
}
