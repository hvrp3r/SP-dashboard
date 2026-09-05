import type { Component } from '@nanoforge-dev/ecs-lib';

export class PositionComponent implements Component {
  name = 'Position';
  constructor(
    public x: number,
    public y: number
  ) {}
}

export class VelocityComponent implements Component {
  name = 'Velocity';
  constructor(public vy: number) {}
}

/** Tag component marking the player-controlled bird entity. */
export class BirdComponent implements Component {
  name = 'Bird';
}
