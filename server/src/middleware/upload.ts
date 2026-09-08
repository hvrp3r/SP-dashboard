import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
export const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');
export const TEAM_LOGOS_DIR = path.join(UPLOADS_DIR, 'team-logos');

fs.mkdirSync(AVATARS_DIR, { recursive: true });
fs.mkdirSync(TEAM_LOGOS_DIR, { recursive: true });

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATARS_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED_MIME_TYPES[file.mimetype] ?? path.extname(file.originalname);
    cb(null, `${req.user!.id}-${Date.now()}${ext}`);
  },
});

const avatarUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES[file.mimetype]) {
      cb(new Error('Format d’image non supporté (PNG, JPEG, WEBP ou GIF uniquement)'));
      return;
    }
    cb(null, true);
  },
});

export function handleAvatarUpload(req: Request, res: Response, next: NextFunction): void {
  avatarUpload.single('avatar')(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Fichier invalide' });
      return;
    }
    next();
  });
}

// Logos d'équipe de tournoi — même pipeline que les avatars, dossier dédié
const teamLogoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEAM_LOGOS_DIR),
  filename: (req, file, cb) => {
    const ext = ALLOWED_MIME_TYPES[file.mimetype] ?? path.extname(file.originalname);
    cb(null, `${req.user!.id}-${Date.now()}${ext}`);
  },
});

const teamLogoUpload = multer({
  storage: teamLogoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES[file.mimetype]) {
      cb(new Error('Format d’image non supporté (PNG, JPEG, WEBP ou GIF uniquement)'));
      return;
    }
    cb(null, true);
  },
});

export function handleTeamLogoUpload(req: Request, res: Response, next: NextFunction): void {
  teamLogoUpload.single('logo')(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Fichier invalide' });
      return;
    }
    next();
  });
}
