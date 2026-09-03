import type { NextFunction, Request, Response } from 'express';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Route introuvable' });
}

interface HttpError extends Error {
  status?: number;
}

export function errorHandler(
  err: HttpError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message ?? 'Erreur serveur' });
}
