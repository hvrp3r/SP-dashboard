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

// Graphics2DLibrary dimensionne le Stage une seule fois, à l'init, avec
// `container.offsetWidth/offsetHeight` — si le conteneur n'a pas encore été
// mis en page à cet instant précis (course avec le premier paint), le stage
// reste bloqué à 0x0. On le recale explicitement une fois le DOM stabilisé.
graphics.stage.size({ width: container.offsetWidth, height: container.offsetHeight });

await registerGame({ graphics, input, sound, ecs });
await client.run();

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
