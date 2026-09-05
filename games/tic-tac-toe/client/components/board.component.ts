import { Circle, Line, Rect } from '@nanoforge-dev/graphics-2d';
import { layer } from '../main.js';

/** Marques du morpion — le serveur est seul juge du plateau, le client ne fait qu'afficher. */
export enum Mark {
  Empty = 0,
  X = 1,
  O = 2,
}

export class Background {
  name = this.constructor.name;
  bg: Rect;

  constructor(width: number, height: number) {
    this.bg = new Rect({ x: 0, y: 0, width, height, fill: '#161625' });
    layer.add(this.bg);
  }
}

export class Board {
  name = this.constructor.name;
  bg: Rect;

  constructor(x: number, y: number, size: number) {
    this.bg = new Rect({ cornerRadius: 15, x, y, width: size, height: size, fill: '#4C2A85' });
    layer.add(this.bg);
  }
}

/**
 * Une case du plateau. `pressed` est lu et remis à `false` par input.system.ts —
 * ce composant ne décide jamais lui-même si le coup est valide (tour du joueur,
 * case vide…), c'est au serveur de le dire via le prochain `matchState`.
 */
export class Cell {
  name = this.constructor.name;
  rect: Rect;
  pressed = false;
  row: number;
  col: number;
  x: number;
  y: number;
  size: number;

  constructor(row: number, col: number, x: number, y: number, size: number) {
    this.rect = new Rect({ cornerRadius: 15, x, y, width: size, height: size, fill: '#23233A' });
    this.row = row;
    this.col = col;
    this.x = x;
    this.y = y;
    this.size = size;

    this.rect.on('mouseover', (e) => {
      e.target.getStage()!.container().style.cursor = 'pointer';
    });
    this.rect.on('mouseout', (e) => {
      e.target.getStage()!.container().style.cursor = 'default';
    });
    this.rect.on('mousedown', () => {
      this.pressed = true;
    });

    layer.add(this.rect);
  }
}

/** Marqueur X ou O purement visuel, posé par board-render.system.ts à partir de l'état serveur. */
export class Marker {
  name = this.constructor.name;

  constructor(x: number, y: number, size: number, symbol: Mark) {
    const padding = size * 0.15;
    const radius = size / 2;

    if (symbol === Mark.X) {
      layer.add(
        new Line({
          points: [x + padding, y + padding, x + size - padding, y + size - padding],
          stroke: '#f87171',
          strokeWidth: 8,
          lineCap: 'round',
        })
      );
      layer.add(
        new Line({
          points: [x + size - padding, y + padding, x + padding, y + size - padding],
          stroke: '#f87171',
          strokeWidth: 8,
          lineCap: 'round',
        })
      );
    } else {
      layer.add(new Circle({ x: x + radius, y: y + radius, radius: radius - padding, fill: '#C084FC' }));
    }
  }
}

// * Required to generate code
export default Board.name;
