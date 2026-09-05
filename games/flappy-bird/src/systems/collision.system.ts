import type { Registry, System } from '@nanoforge-dev/ecs-lib';
import type { Image as KonvaImage } from '@nanoforge-dev/graphics-2d';
import type { SoundManager } from '../sound-manager.js';
import type { GameState } from '../game-state.js';
import type { PipesState } from '../pipes-state.js';

type Rect = { x: number; y: number; width: number; height: number };

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// Le sprite du piaf a une bonne marge transparente/arrondie autour de la forme
// visible — une hitbox égale au sprite entier provoque des collisions qui
// semblent injustes ("il ne touchait pas vraiment"). On la réduit donc de 25%
// de chaque côté (50% en largeur/hauteur au total) autour du centre du sprite.
const BIRD_HITBOX_INSET_RATIO = 0.25;

function shrink(rect: Rect, ratio: number): Rect {
  const insetX = rect.width * ratio;
  const insetY = rect.height * ratio;
  return {
    x: rect.x + insetX,
    y: rect.y + insetY,
    width: rect.width - insetX * 2,
    height: rect.height - insetY * 2,
  };
}

export interface CollisionSystemDeps {
  birdNode: KonvaImage;
  groundY: number;
  pipes: PipesState;
  sound: SoundManager;
  state: GameState;
  onGameOver: () => void;
}

export function createCollisionSystem(deps: CollisionSystemDeps): System {
  const { birdNode, groundY, pipes, sound, state, onGameOver } = deps;

  return (_registry: Registry) => {
    if (!state.running || state.gameOver) return;

    const bird = shrink(birdNode.getClientRect({ skipStroke: true, skipShadow: true }), BIRD_HITBOX_INSET_RATIO);

    let hit = bird.y + bird.height >= groundY;
    if (!hit) {
      for (const pipe of pipes.list) {
        const top = pipe.topGroup.getClientRect({ skipStroke: true, skipShadow: true });
        const bottom = pipe.bottomGroup.getClientRect({ skipStroke: true, skipShadow: true });
        if (overlaps(bird, top) || overlaps(bird, bottom)) {
          hit = true;
          break;
        }
      }
    }

    if (hit) {
      state.gameOver = true;
      sound.play('hit');
      window.setTimeout(() => sound.play('die'), 150);
      onGameOver();
    }
  };
}
