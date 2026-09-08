import type { Request, Response } from 'express';
import * as sudokuService from '../services/sudoku.service.js';
import * as seasonService from '../services/season.service.js';
import * as notificationService from '../services/notification.service.js';

export async function getToday(req: Request, res: Response): Promise<void> {
  const activeSeason = await seasonService.getActiveSeason();
  const view = await sudokuService.getTodayView(req.user!.id, activeSeason?.id ?? null);
  res.json(view);
}

interface ChooseDifficultyBody {
  difficulty?: string;
}

export async function chooseDifficulty(
  req: Request<{}, {}, ChooseDifficultyBody>,
  res: Response
): Promise<void> {
  const difficulty = req.body?.difficulty;
  if (typeof difficulty !== 'string' || !sudokuService.isSudokuDifficulty(difficulty)) {
    res.status(400).json({ error: 'Difficulté invalide' });
    return;
  }

  const activeSeason = await seasonService.getActiveSeason();

  let view;
  try {
    view = await sudokuService.chooseDifficulty(req.user!.id, difficulty, activeSeason?.id ?? null);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  res.status(201).json(view);
}

interface SubmitCellBody {
  cellIndex?: number;
  digit?: string;
}

export async function submitCell(req: Request<{}, {}, SubmitCellBody>, res: Response): Promise<void> {
  const { cellIndex, digit } = req.body ?? {};
  if (typeof cellIndex !== 'number' || typeof digit !== 'string') {
    res.status(400).json({ error: 'Case ou chiffre manquant' });
    return;
  }

  const activeSeason = await seasonService.getActiveSeason();

  let result;
  try {
    result = await sudokuService.submitCell(req.user!.id, activeSeason?.id ?? null, cellIndex, digit);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur serveur' });
    return;
  }

  if (result.status === 'won' && result.rewardGranted) {
    await notificationService.createNotification({
      userId: req.user!.id,
      type: 'sp_gained',
      message:
        result.rewardSp > 0
          ? `Tu as résolu le Sudoku du jour — +${result.rewardSp} SP`
          : 'Tu as résolu le Sudoku du jour',
      link: '/sudoku',
    });
  }

  res.status(201).json(result);
}

export async function getTodayAdmin(_req: Request, res: Response): Promise<void> {
  const activeSeason = await seasonService.getActiveSeason();
  const view = await sudokuService.getTodayAdminView(activeSeason?.id ?? null);
  res.json(view);
}

export async function listAttempts(req: Request, res: Response): Promise<void> {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
  const attempts = await sudokuService.listRecentAttempts(limit);
  res.json(attempts);
}
