import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import type { NextFunction, Request, Response } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
export const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');
export const TEAM_LOGOS_DIR = path.join(UPLOADS_DIR, 'team-logos');
// Images génériques uploadées par le MSP (caisses, gains, cosmétiques…)
export const IMAGES_DIR = path.join(UPLOADS_DIR, 'images');

fs.mkdirSync(AVATARS_DIR, { recursive: true });
fs.mkdirSync(TEAM_LOGOS_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

// Le SVG peut embarquer du script : réservé aux uploads MSP (images génériques),
// jamais aux avatars/logos envoyés par n'importe quel joueur.
const PLAYER_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function makeImageUpload(
  dir: string,
  field: string,
  maxBytes: number,
  mimeTypes: string[]
): (req: Request, res: Response, next: NextFunction) => void {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, dir),
      filename: (req, file, cb) => {
        const ext = ALLOWED_MIME_TYPES[file.mimetype] ?? path.extname(file.originalname);
        cb(null, `${req.user!.id}-${Date.now()}${ext}`);
      },
    }),
    limits: { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
      if (!mimeTypes.includes(file.mimetype)) {
        const labels = mimeTypes.map((m) => ALLOWED_MIME_TYPES[m]!.slice(1).toUpperCase());
        cb(new Error(`Format d’image non supporté (${labels.join(', ')} uniquement)`));
        return;
      }
      cb(null, true);
    },
  });

  return (req, res, next) => {
    upload.single(field)(req, res, (err: unknown) => {
      if (err) {
        const message =
          err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
            ? `Fichier trop lourd (${Math.round(maxBytes / 1024 / 1024)} Mo max)`
            : err instanceof Error
              ? err.message
              : 'Fichier invalide';
        res.status(400).json({ error: message });
        return;
      }
      next();
    });
  };
}

export const handleAvatarUpload = makeImageUpload(
  AVATARS_DIR,
  'avatar',
  2 * 1024 * 1024,
  PLAYER_MIME_TYPES
);

// Logos d'équipe de tournoi — même pipeline que les avatars, dossier dédié
export const handleTeamLogoUpload = makeImageUpload(
  TEAM_LOGOS_DIR,
  'logo',
  2 * 1024 * 1024,
  PLAYER_MIME_TYPES
);

export const handleImageUpload = makeImageUpload(
  IMAGES_DIR,
  'image',
  5 * 1024 * 1024,
  Object.keys(ALLOWED_MIME_TYPES)
);
