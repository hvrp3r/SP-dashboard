import type { Request, Response } from 'express';
import * as leaderboardService from '../services/leaderboard.service.js';
import type { LeaderboardSort } from '../types.js';

const VALID_SORTS: LeaderboardSort[] = ['sp_balance', 'sp_total_earned'];

export async function getLeaderboard(req: Request, res: Response): Promise<void> {
  const sortParam = (req.query.sort as string | undefined) ?? 'sp_balance';
  if (!VALID_SORTS.includes(sortParam as LeaderboardSort)) {
    res.status(400).json({ error: 'Tri invalide' });
    return;
  }

  const entries = await leaderboardService.getLeaderboard(sortParam as LeaderboardSort);
  res.json(entries);
}
