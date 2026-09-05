import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.wav': 'audio/wav',
};

/**
 * Vite (en dev uniquement) ne sert pas correctement un `.js` pré-bundlé placé
 * dans `public/` : son middleware de transform de modules intercepte toute
 * requête d'extension JS avant le static-serve de `publicDir`, échoue à la
 * résoudre comme module source, et la requête retombe sur le fallback SPA — le
 * fichier existe pourtant bien sur disque (constaté avec `client/public/games/
 * flappy-bird/assets/*.js`, servi par erreur avec l'index.html de l'app React).
 * Sans impact en production : Caddy y sert `dist/` en fichiers statiques bruts,
 * sans ce pipeline de transform. On sert donc nous-mêmes ce sous-dossier
 * directement depuis le disque, en middleware prioritaire (avant les
 * middlewares internes de Vite, d'où l'appel direct à `server.middlewares.use`
 * plutôt qu'un retour de fonction dans `configureServer`).
 */
function serveGamesDirectly(): Plugin {
  return {
    name: 'serve-games-directly',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/games/')) return next();
        const urlPath = req.url.split('?')[0]!;
        const filePath = path.join(server.config.publicDir, urlPath);
        fs.readFile(filePath, (err, data) => {
          if (err) return next();
          const ext = path.extname(filePath);
          res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
          res.end(data);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveGamesDirectly()],
  server: {
    port: 5173,
  },
});
