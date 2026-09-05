import type { Registry, System } from '@nanoforge-dev/ecs-lib';
import { Group as KonvaGroup, Image as KonvaImage, type Layer } from '@nanoforge-dev/graphics-2d';
import type { SoundManager } from '../sound-manager.js';
import type { GameState } from '../game-state.js';
import type { PipesState } from '../pipes-state.js';
import { postPointScored } from '../bridge.js';

export interface ScoreSystemDeps {
  birdX: number;
  pipeWidth: number;
  layer: Layer;
  digits: HTMLImageElement[];
  stageWidth: number;
  sound: SoundManager;
  pipes: PipesState;
  state: GameState;
}

/** Affiche le score courant avec les sprites de chiffres, centré en haut de l'écran. */
function renderScore(deps: ScoreSystemDeps, group: KonvaGroup): void {
  group.destroyChildren();

  const text = String(deps.state.score);
  const digitWidth = deps.digits[0]?.naturalWidth ?? 24;
  const digitHeight = deps.digits[0]?.naturalHeight ?? 36;
  const totalWidth = text.length * digitWidth;
  let x = (deps.stageWidth - totalWidth) / 2;

  for (const char of text) {
    const image = deps.digits[Number(char)];
    if (!image) continue;
    group.add(new KonvaImage({ image, x, y: 20, width: digitWidth, height: digitHeight }));
    x += digitWidth;
  }
}

export interface ScoreSystemControls {
  tick: System;
  /** Redessine l'affichage du score (ex: remise à 0 lors d'un redémarrage en jeu). */
  resetDisplay: () => void;
}

export function createScoreSystem(deps: ScoreSystemDeps): ScoreSystemControls {
  // Groupe dédié plutôt que des Image ajoutées en vrac sur le calque : chaque
  // nouveau tuyau est ajouté APRÈS les chiffres (donc par-dessus, dans Konva
  // l'ordre d'ajout = l'ordre de rendu) — on remet le groupe au premier plan à
  // chaque tick pour que le score reste toujours visible au-dessus des tuyaux.
  const group = new KonvaGroup();
  deps.layer.add(group);
  renderScore(deps, group);

  const tick: System = (_registry: Registry) => {
    group.moveToTop();
    if (!deps.state.running || deps.state.gameOver) return;

    for (const pipe of deps.pipes.list) {
      if (!pipe.scored && pipe.x + deps.pipeWidth < deps.birdX) {
        pipe.scored = true;
        deps.state.score += 1;
        deps.sound.play('point');
        postPointScored();
        renderScore(deps, group);
      }
    }
  };

  return {
    tick,
    resetDisplay: () => renderScore(deps, group),
  };
}
