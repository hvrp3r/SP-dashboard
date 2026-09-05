import { Text } from '@nanoforge-dev/graphics-2d';
import { layer } from '../main.js';

/** Bandeau de statut en haut de l'écran ("En attente…", "À toi de jouer", "Tu as gagné !"…). */
export class StatusText {
  name = this.constructor.name;
  text: Text;
  private readonly centerX: number;
  private lastMessage: string | null = null;

  constructor(x: number, y: number) {
    this.centerX = x;
    this.text = new Text({
      x,
      y,
      text: '',
      fontSize: 24,
      fontStyle: 'bold',
      fill: '#c5b6d6',
      align: 'center',
    });
    layer.add(this.text);
  }

  /** Recentre autour de `centerX` à chaque appel — la largeur du texte varie avec son contenu. */
  update(message: string): void {
    if (message === this.lastMessage) return;
    this.lastMessage = message;
    this.text.text(message);
    this.text.x(this.centerX - this.text.width() / 2);
  }
}

// * Required to generate code
export default StatusText.name;
