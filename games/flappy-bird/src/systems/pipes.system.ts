import type { Context } from '@nanoforge-dev/common';
import type { Registry, System } from '@nanoforge-dev/ecs-lib';
import { Group as KonvaGroup, Image as KonvaImage, type Layer, type Rect } from '@nanoforge-dev/graphics-2d';
import type { GameState } from '../game-state.js';
import type { PipesState } from '../pipes-state.js';

const BASE_PIPE_GAP = 150;
const MIN_PIPE_GAP = 110; // plancher — la trouée ne doit jamais devenir injouable
const GAP_DIFFICULTY_STEP = 2.5; // px de trouée en moins par point marqué
const GAP_JITTER = 16; // variation aléatoire (± px) autour de la trouée courante, par tuyau
const PIPE_SPEED = 150; // px/s
const SPAWN_INTERVAL = 1.5; // s
// Le capuchon du sprite (rebord large) fait 24px de haut sur les 320px du sprite
// source (mesuré : pixels pleine largeur de y=0 à 23, puis rétrécis ensuite) — le
// reste est un corps de couleur unie qui s'étire proprement sans distorsion visible.
const CAP_HEIGHT = 24;
// Distance min. entre le bord de l'écran jouable et la trouée : assez grand pour
// qu'il reste toujours un capuchon net + un peu de corps visible (jamais un moignon
// de tuyau écrasé/invisible collé au bord).
const EDGE_MARGIN = 60;

export interface PipesSystemDeps {
  layer: Layer;
  pipeImage: HTMLImageElement;
  stageWidth: number;
  stageHeight: number;
  groundHeight: number;
  ground: Rect;
  pipes: PipesState;
  state: GameState;
}

/**
 * Construit un tuyau en deux morceaux plutôt que d'étirer le sprite entier :
 * le capuchon garde sa taille native (jamais distordu/écrasé), seul le corps
 * (couleur unie, sans détail) est étiré pour atteindre la longueur voulue.
 * `flipped` inverse le capuchon (tuyau du haut, ouverture vers le bas).
 */
function createPipeSegment(
  pipeImage: HTMLImageElement,
  pipeWidth: number,
  totalHeight: number,
  flipped: boolean
): KonvaGroup {
  const group = new KonvaGroup();
  const bodyHeight = Math.max(0, totalHeight - CAP_HEIGHT);

  const body = new KonvaImage({
    image: pipeImage,
    crop: { x: 0, y: CAP_HEIGHT, width: pipeWidth, height: 320 - CAP_HEIGHT },
    x: 0,
    y: flipped ? 0 : CAP_HEIGHT,
    width: pipeWidth,
    height: bodyHeight,
  });
  const cap = new KonvaImage({
    image: pipeImage,
    crop: { x: 0, y: 0, width: pipeWidth, height: CAP_HEIGHT },
    x: 0,
    y: flipped ? bodyHeight : 0,
    width: pipeWidth,
    height: CAP_HEIGHT,
    scaleY: flipped ? -1 : 1,
    offsetY: flipped ? CAP_HEIGHT : 0,
  });
  group.add(body);
  group.add(cap);
  return group;
}

export function createPipesSystem(deps: PipesSystemDeps): System {
  const { layer, pipeImage, stageWidth, stageHeight, groundHeight, ground, pipes, state } = deps;
  const pipeWidth = pipeImage.naturalWidth || 52;
  const groundY = stageHeight - groundHeight;
  const playableHeight = groundY;

  return (registry: Registry, ctx: Context) => {
    // Le sol défile toujours, même après game over (petit effet visuel), tant que la partie a démarré.
    if (state.running) {
      ground.fillPatternX((ground.fillPatternX() ?? 0) - PIPE_SPEED * (ctx.app.delta / 1000));
    }
    if (!state.running || state.gameOver) return;

    const dt = ctx.app.delta / 1000;
    pipes.spawnTimer -= dt;
    if (pipes.spawnTimer <= 0) {
      pipes.spawnTimer = SPAWN_INTERVAL;

      // Difficulté progressive légère : la trouée de base rétrécit avec le score
      // (plancher à MIN_PIPE_GAP pour rester jouable), et chaque tuyau reçoit en plus
      // une petite variation aléatoire pour ne pas avoir un écart parfaitement identique
      // à chaque fois.
      const difficultyGap = Math.max(MIN_PIPE_GAP, BASE_PIPE_GAP - state.score * GAP_DIFFICULTY_STEP);
      const gap = Math.max(MIN_PIPE_GAP, difficultyGap + (Math.random() * 2 - 1) * GAP_JITTER);

      // Le centre de la trouée est borné en fonction de sa propre taille (`gap`), pas
      // d'une marge fixe — sinon une grande trouée randomisée près d'un bord donnerait
      // une hauteur de tuyau négative.
      const centerMin = gap / 2 + EDGE_MARGIN;
      const centerMax = playableHeight - gap / 2 - EDGE_MARGIN;
      const gapCenterY = centerMin + Math.random() * Math.max(0, centerMax - centerMin);
      // Les tuyaux s'étendent toujours jusqu'aux bords de l'écran jouable (0 en haut,
      // le sol en bas) — sinon le piaf peut passer par-dessus/dessous quand la trouée
      // est positionnée près d'un bord et que le sprite (hauteur fixe) est trop court.
      const topHeight = gapCenterY - gap / 2;
      const bottomHeight = groundY - (gapCenterY + gap / 2);

      const entity = registry.spawnEntity();
      const topGroup = createPipeSegment(pipeImage, pipeWidth, topHeight, true);
      topGroup.position({ x: stageWidth, y: 0 });
      const bottomGroup = createPipeSegment(pipeImage, pipeWidth, bottomHeight, false);
      bottomGroup.position({ x: stageWidth, y: gapCenterY + gap / 2 });

      layer.add(topGroup);
      layer.add(bottomGroup);
      ground.moveToTop();
      pipes.list.push({ entity, topGroup, bottomGroup, x: stageWidth, scored: false });
    }

    for (const pipe of pipes.list) {
      pipe.x -= PIPE_SPEED * dt;
      pipe.topGroup.x(pipe.x);
      pipe.bottomGroup.x(pipe.x);
    }

    pipes.list = pipes.list.filter((pipe) => {
      if (pipe.x + pipeWidth < 0) {
        registry.killEntity(pipe.entity);
        pipe.topGroup.destroy();
        pipe.bottomGroup.destroy();
        return false;
      }
      return true;
    });
  };
}
