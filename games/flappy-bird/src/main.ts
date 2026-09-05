import { NanoforgeFactory } from '@nanoforge-dev/core';
import { AssetManagerLibrary } from '@nanoforge-dev/asset-manager';
import { Graphics2DLibrary } from '@nanoforge-dev/graphics-2d';
import { InputLibrary } from '@nanoforge-dev/input';
import { ECSClientLibrary } from '@nanoforge-dev/ecs-client';
import { registerGame } from './game.js';
import { SoundManager } from './sound-manager.js';

const base = import.meta.env.BASE_URL;

// AssetManagerLibrary normalise toujours la clé avec un slash de tête avant
// la recherche (`_parsePath`) — la clé stockée doit donc l'avoir aussi.
const files = new Map<string, string>([['/libecs.wasm', `${base}libecs.wasm`]]);

// Résolution logique FIXE du jeu, indépendante de la taille réelle de l'iframe.
// Ratio 3:4, identique à celui imposé par le conteneur côté SP
// (client/src/components/FlappyBirdEmbed.tsx) — sur une taille d'iframe normale,
// le rendu est donc inchangé (scale ≈ 1). Toute la difficulté (trouée des tuyaux,
// hauteur du sol…) est calculée en pixels de CETTE résolution, jamais de la taille
// réelle du conteneur : un joueur qui redimensionne l'iframe via DevTools (ex: très
// courte et large) ne change donc plus le ratio trouée/hauteur, seule la présentation
// visuelle s'adapte (voir applyResponsiveScale plus bas, pur CSS, aucun effet sur le
// gameplay).
const GAME_WIDTH = 420;
const GAME_HEIGHT = 560;

const container = document.getElementById('game-container') as HTMLDivElement;
// Élément qui passe en plein écran — doit englober aussi les boutons/slider,
// pas seulement #game-container (que Konva vide et gère seul).
const fullscreenRoot = document.getElementById('game-root') as HTMLDivElement;

const client = NanoforgeFactory.createClient({ tickRate: 60 });
const assetManager = new AssetManagerLibrary();
const graphics = new Graphics2DLibrary();
const input = new InputLibrary();
const ecs = new ECSClientLibrary();
// @nanoforge-dev/sound n'offre qu'un bascule mute/unmute, aucun contrôle de volume —
// on gère donc nos propres HTMLAudioElement (voir sound-manager.ts) pour le slider.
const sound = new SoundManager();

client.useAssetManager(assetManager);
client.useGraphics(graphics);
client.useInput(input);
client.useComponentSystem(ecs);

await client.init({ container, files, env: {} });

// On écrase la taille que Graphics2DLibrary vient de donner au Stage (basée sur
// `container.offsetWidth/offsetHeight`, donc sur une taille d'iframe non fiable)
// par notre résolution logique fixe. `stage.width()`/`height()` (lus par game.ts
// et les systems) renvoient alors toujours GAME_WIDTH/GAME_HEIGHT, quoi qu'il
// arrive à l'iframe.
graphics.stage.size({ width: GAME_WIDTH, height: GAME_HEIGHT });
container.style.width = `${GAME_WIDTH}px`;
container.style.height = `${GAME_HEIGHT}px`;

/**
 * Adapte visuellement le rendu à l'espace réellement disponible via un simple
 * `transform: scale()` CSS sur #game-container — ne touche ni à la résolution du
 * Stage Konva, ni aux coordonnées de jeu (collisions, position des tuyaux…),
 * seulement à la taille affichée à l'écran. Letterboxé (`Math.min`) pour ne
 * jamais déformer le ratio. En plein écran, le CSS dédié de index.html
 * (`#game-root:fullscreen canvas`) prend le relai directement sur le canvas —
 * on désactive alors ce scale pour éviter un double scaling.
 */
function applyResponsiveScale(): void {
  if (document.fullscreenElement) {
    container.style.transform = '';
    return;
  }
  const availWidth = fullscreenRoot.clientWidth;
  const availHeight = fullscreenRoot.clientHeight;
  const scale = availWidth > 0 && availHeight > 0
    ? Math.min(availWidth / GAME_WIDTH, availHeight / GAME_HEIGHT)
    : 1;
  container.style.transform = `scale(${scale})`;
}

applyResponsiveScale();
// Le tout premier calcul peut tomber pendant que l'iframe n'a pas encore été
// mise en page (mêmes symptômes que l'ancienne course sur offsetWidth/Height) —
// un second passage après le paint suivant s'en remet.
requestAnimationFrame(applyResponsiveScale);
window.addEventListener('resize', applyResponsiveScale);
document.addEventListener('fullscreenchange', applyResponsiveScale);

const game = await registerGame({ graphics, input, sound, ecs });
await client.run();

// @nanoforge-dev/input n'écoute que mousedown/mouseup/keydown — aucun événement
// tactile. Combiné à `touch-action: none` sur le canvas (nécessaire pour bloquer
// le scroll/zoom pendant la partie), ça supprime aussi la synthèse de clics par le
// navigateur sur mobile : sans ce listener, aucune touche ne réagit sur téléphone.
container.addEventListener(
  'touchstart',
  (e) => {
    e.preventDefault();
    game.flap();
  },
  { passive: false }
);

// Boutons/slider superposés au jeu — stopPropagation empêche leurs interactions
// d'être aussi lues comme un saut par InputLibrary (qui écoute mousedown sur
// `window`, peu importe la cible).
const fullscreenBtn = document.getElementById('fullscreen-btn');
fullscreenBtn?.addEventListener('mousedown', (e) => e.stopPropagation());
fullscreenBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    fullscreenRoot.requestFullscreen().catch(() => {
      // Plein écran refusé/non supporté (ex: iframe sans permission) — pas grave, on ignore.
    });
  }
});

const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement | null;
if (volumeSlider) {
  volumeSlider.value = String(Math.round(sound.getVolume() * 100));
  volumeSlider.addEventListener('mousedown', (e) => e.stopPropagation());
  volumeSlider.addEventListener('click', (e) => e.stopPropagation());
  volumeSlider.addEventListener('input', (e) => {
    e.stopPropagation();
    sound.setVolume(Number(volumeSlider.value) / 100);
  });
}
