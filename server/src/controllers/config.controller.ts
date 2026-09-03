import type { Request, Response } from 'express';
import * as configService from '../services/config.service.js';

export async function listConfig(req: Request, res: Response): Promise<void> {
  const config = await configService.listConfig();
  res.json(config);
}

interface UpdateConfigBody {
  value?: string;
}

export async function updateConfig(
  req: Request<{ key: string }, {}, UpdateConfigBody>,
  res: Response
): Promise<void> {
  const { key } = req.params;
  const value = req.body?.value?.trim();

  if (!value) {
    res.status(400).json({ error: 'La valeur est requise' });
    return;
  }
  if (!/^-?\d+$/.test(value)) {
    res.status(400).json({ error: 'La valeur doit être un nombre entier' });
    return;
  }

  const updated = await configService.setConfigValue(key, value, req.user!.id);
  if (!updated) {
    res.status(404).json({ error: 'Clé de configuration introuvable' });
    return;
  }
  res.json(updated);
}
