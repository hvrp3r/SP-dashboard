import type { Registry, System } from '@nanoforge-dev/ecs-lib';
import { InputEnum, type InputLibrary } from '@nanoforge-dev/input';

/**
 * Détecte le FRONT MONTANT (nouvel appui, pas maintien) de la barre d'espace,
 * du clic gauche ou d'un tap tactile, et déclenche `onFlap` une seule fois
 * par appui — sinon rester appuyé ferait sauter le piaf en continu.
 */
export function createInputSystem(input: InputLibrary, onFlap: () => void): System {
  let wasPressed = false;
  return (_registry: Registry) => {
    const pressed = Boolean(input.isKeyPressed(InputEnum.Space) || input.isKeyPressed(InputEnum.MouseLeft));
    if (pressed && !wasPressed) {
      onFlap();
    }
    wasPressed = pressed;
  };
}
