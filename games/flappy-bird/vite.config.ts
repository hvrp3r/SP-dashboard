import { defineConfig, type Plugin } from 'vite';

/**
 * @nanoforge-dev/ecs-client contient un `import "./libecs.wasm"` de type
 * "ESM Wasm integration proposal" (pensé pour être bundlé par `bun`, l'outil
 * officiel de NanoForge) — non supporté par Rollup/Vite. Ce import statique
 * n'est en réalité jamais utilisé : le binaire wasm est chargé dynamiquement
 * via fetch() à partir de la `files` map fournie à `client.init()` (voir
 * src/main.ts). On neutralise donc cet import mort plutôt que d'ajouter un
 * plugin wasm complet dont on n'a pas besoin.
 */
function ignoreNanoforgeWasmImport(): Plugin {
  return {
    name: 'ignore-nanoforge-wasm-import',
    load(id) {
      if (id.endsWith('.wasm')) return 'export default undefined;';
    },
  };
}

export default defineConfig({
  base: '/games/flappy-bird/',
  plugins: [ignoreNanoforgeWasmImport()],
  build: {
    target: 'esnext',
    outDir: '../../client/public/games/flappy-bird',
    emptyOutDir: true,
  },
});
