import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import seasonsRoutes from './routes/seasons.routes.js';
import leaderboardRoutes from './routes/leaderboard.routes.js';
import configRoutes from './routes/config.routes.js';
import transactionsRoutes from './routes/transactions.routes.js';
import challengesRoutes from './routes/challenges.routes.js';
import minigamesRoutes from './routes/minigames.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import { UPLOADS_DIR } from './middleware/upload.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

export function createApp(): Express {
  const app = express();

  app.use(
    cors({
      origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
      credentials: true,
    })
  );
  app.use(express.json());
  app.use(cookieParser());

  app.use('/uploads', express.static(UPLOADS_DIR));

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/seasons', seasonsRoutes);
  app.use('/api/leaderboard', leaderboardRoutes);
  app.use('/api/config', configRoutes);
  app.use('/api/transactions', transactionsRoutes);
  app.use('/api/challenges', challengesRoutes);
  app.use('/api/minigames', minigamesRoutes);
  app.use('/api/notifications', notificationsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
