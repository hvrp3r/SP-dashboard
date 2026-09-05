function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Impossible de charger l'image ${url}`));
    img.src = url;
  });
}

export interface Sprites {
  background: HTMLImageElement;
  ground: HTMLImageElement;
  birdFrames: HTMLImageElement[];
  pipe: HTMLImageElement;
  gameover: HTMLImageElement;
  message: HTMLImageElement;
  digits: HTMLImageElement[];
}

const base = import.meta.env.BASE_URL;

export async function loadSprites(): Promise<Sprites> {
  const [background, ground, up, mid, down, pipe, gameover, message, ...digits] = await Promise.all([
    loadImage(`${base}sprites/background-day.png`),
    loadImage(`${base}sprites/base.png`),
    loadImage(`${base}sprites/yellowbird-upflap.png`),
    loadImage(`${base}sprites/yellowbird-midflap.png`),
    loadImage(`${base}sprites/yellowbird-downflap.png`),
    loadImage(`${base}sprites/pipe-green.png`),
    loadImage(`${base}sprites/gameover.png`),
    loadImage(`${base}sprites/message.png`),
    ...Array.from({ length: 10 }, (_, i) => loadImage(`${base}sprites/${i}.png`)),
  ]);
  return { background, ground, birdFrames: [up, mid, down], pipe, gameover, message, digits };
}

export async function loadSounds(sound: {
  load: (key: string, file: string) => void;
}): Promise<void> {
  sound.load('wing', `${base}audio/wing.wav`);
  sound.load('hit', `${base}audio/hit.wav`);
  sound.load('point', `${base}audio/point.wav`);
  sound.load('die', `${base}audio/die.wav`);
  sound.load('swoosh', `${base}audio/swoosh.wav`);
}
