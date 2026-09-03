import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import * as userService from '../services/user.service.js';
import * as statsService from '../services/stats.service.js';
import * as loginBonusService from '../services/loginBonus.service.js';
import { AVATARS_DIR } from '../middleware/upload.js';

export async function getMe(req: Request, res: Response): Promise<void> {
  const profile = await userService.getPrivateProfile(req.user!.id);
  if (!profile) {
    res.status(404).json({ error: 'Utilisateur introuvable' });
    return;
  }
  res.json(profile);
}

export async function claimDailyBonus(req: Request, res: Response): Promise<void> {
  let claim;
  try {
    claim = await loginBonusService.claimDailyLoginBonus(req.user!.id);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  const profile = await userService.getPrivateProfile(req.user!.id);
  if (!profile) {
    res.status(404).json({ error: 'Utilisateur introuvable' });
    return;
  }
  res.json({ profile, alreadyClaimed: claim.alreadyClaimed, amount: claim.amount, streak: claim.streak });
}

export async function getPublicProfile(
  req: Request<{ username: string }>,
  res: Response
): Promise<void> {
  const profile = await userService.getPublicProfile(req.params.username);
  if (!profile) {
    res.status(404).json({ error: 'Utilisateur introuvable' });
    return;
  }
  res.json(profile);
}

export async function getStats(req: Request<{ username: string }>, res: Response): Promise<void> {
  const profile = await userService.getPublicProfile(req.params.username);
  if (!profile) {
    res.status(404).json({ error: 'Utilisateur introuvable' });
    return;
  }
  const stats = await statsService.getPlayerStats(profile.id);
  res.json(stats);
}

interface SetLeaderboardVisibilityBody {
  hidden?: boolean;
}

export async function setLeaderboardVisibility(
  req: Request<{}, {}, SetLeaderboardVisibilityBody>,
  res: Response
): Promise<void> {
  const hidden = req.body?.hidden;
  if (typeof hidden !== 'boolean') {
    res.status(400).json({ error: 'Le champ hidden (booléen) est requis' });
    return;
  }

  const profile = await userService.setLeaderboardHidden(req.user!.id, hidden);
  if (!profile) {
    res.status(404).json({ error: 'Utilisateur introuvable' });
    return;
  }
  res.json(profile);
}

export async function uploadAvatar(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    res.status(400).json({ error: 'Aucun fichier reçu' });
    return;
  }

  const avatarUrl = `/uploads/avatars/${req.file.filename}`;
  const previous = await userService.findById(req.user!.id);

  await userService.updateAvatar(req.user!.id, avatarUrl);

  if (previous?.avatar_url?.startsWith('/uploads/avatars/')) {
    const oldPath = path.join(AVATARS_DIR, path.basename(previous.avatar_url));
    fs.unlink(oldPath, () => {});
  }

  const profile = await userService.getPrivateProfile(req.user!.id);
  res.json(profile);
}
