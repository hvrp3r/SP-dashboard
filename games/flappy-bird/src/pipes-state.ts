import type { Entity } from '@nanoforge-dev/ecs-lib';
import type { Group } from '@nanoforge-dev/graphics-2d';

export interface PipeRecord {
  entity: Entity;
  /** Groupe (capuchon + corps) du tuyau du haut. */
  topGroup: Group;
  /** Groupe (capuchon + corps) du tuyau du bas. */
  bottomGroup: Group;
  x: number;
  scored: boolean;
}

export class PipesState {
  list: PipeRecord[] = [];
  spawnTimer = 0;
}
