import type { Context } from '@nanoforge-dev/common';
import type { Entity, Registry, System } from '@nanoforge-dev/ecs-lib';
import type { Image as KonvaImage } from '@nanoforge-dev/graphics-2d';
import { PositionComponent, VelocityComponent } from '../components.js';
import type { GameState } from '../game-state.js';

const GRAVITY = 1500; // px/s²
const FLAP_VELOCITY = -430; // px/s (impulsion vers le haut)
const MAX_FALL_SPEED = 640;

export function createPhysicsSystem(bird: Entity, birdNode: KonvaImage, state: GameState): System {
  return (registry: Registry, ctx: Context) => {
    if (!state.running || state.gameOver) return;

    const pos = registry.getEntityComponent(bird, new PositionComponent(0, 0)) as PositionComponent;
    const vel = registry.getEntityComponent(bird, new VelocityComponent(0)) as VelocityComponent;
    if (!pos || !vel) return;

    const dt = Math.min(ctx.app.delta / 1000, 1 / 30);
    vel.vy = Math.min(vel.vy + GRAVITY * dt, MAX_FALL_SPEED);
    pos.y += vel.vy * dt;

    birdNode.y(pos.y);
    birdNode.rotation(Math.max(-25, Math.min(90, vel.vy / 8)));

    // Empêche le piaf de sortir par le haut de l'écran — sans ça, il peut voler
    // entièrement au-dessus de y=0 et donc "passer par-dessus" le tuyau du haut,
    // qui s'arrête pile au bord de l'écran (voir pipes.system.ts). On utilise le
    // rect réellement rendu (rotation/offset compris) plutôt que pos.y directement.
    const rect = birdNode.getClientRect({ skipStroke: true, skipShadow: true });
    if (rect.y < 0) {
      pos.y -= rect.y;
      birdNode.y(pos.y);
      if (vel.vy < 0) vel.vy = 0;
    }
  };
}

/** Appelée par le système d'input : donne une impulsion vers le haut au piaf. */
export function flap(registry: Registry, bird: Entity): void {
  const vel = registry.getEntityComponent(bird, new VelocityComponent(0)) as VelocityComponent;
  if (vel) vel.vy = FLAP_VELOCITY;
}
