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
  next: NextFunction
): void {
  console.error(err);
  // Response already partly sent: let express close the connection.
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(err.status ?? 500).json({ error: err.message ?? 'Erreur serveur' });
}
