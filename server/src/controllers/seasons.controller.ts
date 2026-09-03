import type { Request, Response } from 'express';
import * as seasonService from '../services/season.service.js';
import type { SeasonStatus } from '../types.js';

export async function listSeasons(req: Request, res: Response): Promise<void> {
  const status = req.query.status as string | undefined;
  if (status && status !== 'active' && status !== 'closed') {
    res.status(400).json({ error: 'Statut invalide' });
    return;
  }
  const seasons = await seasonService.listSeasons(status as SeasonStatus | undefined);
  res.json(seasons);
}

export async function getActiveSeason(req: Request, res: Response): Promise<void> {
  const season = await seasonService.getActiveSeason();
  res.json(season);
}

export async function getSnapshot(req: Request<{ id: string }>, res: Response): Promise<void> {
  const seasonId = Number(req.params.id);
  if (!Number.isInteger(seasonId)) {
    res.status(400).json({ error: 'Identifiant de saison invalide' });
    return;
  }

  const season = await seasonService.getSeasonById(seasonId);
  if (!season) {
    res.status(404).json({ error: 'Saison introuvable' });
    return;
  }

  const snapshot = await seasonService.getSeasonSnapshot(seasonId);
  res.json({ season, snapshot });
}

interface CreateSeasonBody {
  name?: string;
  startsAt?: string;
}

export async function createSeason(
  req: Request<{}, {}, CreateSeasonBody>,
  res: Response
): Promise<void> {
  const { name, startsAt } = req.body ?? {};

  if (!name || !name.trim()) {
    res.status(400).json({ error: 'Le nom de la saison est requis' });
    return;
  }
  if (name.trim().length > 100) {
    res.status(400).json({ error: 'Le nom ne doit pas dépasser 100 caractères' });
    return;
  }
  if (startsAt && Number.isNaN(Date.parse(startsAt))) {
    res.status(400).json({ error: 'Date de début invalide' });
    return;
  }

  const active = await seasonService.getActiveSeason();
  if (active) {
    res
      .status(409)
      .json({ error: 'Une saison est déjà active. Clôturez-la avant d’en créer une nouvelle.' });
    return;
  }

  const season = await seasonService.createSeason({
    name: name.trim(),
    startsAt,
    createdBy: req.user!.id,
  });
  res.status(201).json(season);
}

export async function closeSeason(req: Request<{ id: string }>, res: Response): Promise<void> {
  const seasonId = Number(req.params.id);
  if (!Number.isInteger(seasonId)) {
    res.status(400).json({ error: 'Identifiant de saison invalide' });
    return;
  }

  const season = await seasonService.getSeasonById(seasonId);
  if (!season) {
    res.status(404).json({ error: 'Saison introuvable' });
    return;
  }
  if (season.status !== 'active') {
    res.status(400).json({ error: 'Cette saison est déjà clôturée' });
    return;
  }

  const closed = await seasonService.closeSeason(seasonId);
  res.json(closed);
}
