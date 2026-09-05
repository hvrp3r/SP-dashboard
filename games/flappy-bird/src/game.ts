import { Image as KonvaImage, Rect as KonvaRect, type Graphics2DLibrary } from '@nanoforge-dev/graphics-2d';
import type { InputLibrary } from '@nanoforge-dev/input';
import type { ECSClientLibrary } from '@nanoforge-dev/ecs-client';
import { PositionComponent, VelocityComponent, BirdComponent } from './components.js';
import { GameState } from './game-state.js';
import { PipesState } from './pipes-state.js';
import { loadSprites, loadSounds } from './assets.js';
import type { SoundManager } from './sound-manager.js';
import { createInputSystem } from './systems/input.system.js';
import { createPhysicsSystem, flap } from './systems/physics.system.js';
import { createPipesSystem } from './systems/pipes.system.js';
import { createCollisionSystem } from './systems/collision.system.js';
import { createScoreSystem } from './systems/score.system.js';
import { postGameOver } from './bridge.js';

const BIRD_X = 60;
const GROUND_HEIGHT = 112;
const RESTART_COOLDOWN_MS = 400;

export interface GameLibraries {
  graphics: Graphics2DLibrary;
  input: InputLibrary;
  sound: SoundManager;
  ecs: ECSClientLibrary;
}

export async function registerGame(libs: GameLibraries): Promise<void> {
  const { graphics, input, sound, ecs } = libs;
  const stage = graphics.stage;
  const layer = graphics.baseLayer;
  const stageWidth = stage.width();
  const stageHeight = stage.height();

  const [sprites] = await Promise.all([loadSprites(), loadSounds(sound)]);

  const state = new GameState();
  const pipes = new PipesState();

  // --- Décor ---
  const background = new KonvaImage({
    image: sprites.background,
    x: 0,
    y: 0,
    width: stageWidth,
    height: stageHeight,
  });
  layer.add(background);

  const ground = new KonvaRect({
    x: 0,
    y: stageHeight - GROUND_HEIGHT,
    width: stageWidth,
    height: GROUND_HEIGHT,
    fillPatternImage: sprites.ground,
    fillPatternRepeat: 'repeat-x',
  });
  layer.add(ground);

  // --- Piaf ---
  const registry = ecs.registry;
  const bird = registry.spawnEntity();
  registry.addComponent(bird, new PositionComponent(BIRD_X, stageHeight / 2));
  registry.addComponent(bird, new VelocityComponent(0));
  registry.addComponent(bird, new BirdComponent());

  const birdFrameWidth = sprites.birdFrames[1]?.naturalWidth ?? 34;
  const birdFrameHeight = sprites.birdFrames[1]?.naturalHeight ?? 24;
  const birdNode = new KonvaImage({
    image: sprites.birdFrames[1],
    x: BIRD_X,
    y: stageHeight / 2,
    width: birdFrameWidth,
    height: birdFrameHeight,
    offsetX: birdFrameWidth / 2,
    offsetY: birdFrameHeight / 2,
  });
  layer.add(birdNode);

  // --- Écran de démarrage ---
  const message = new KonvaImage({
    image: sprites.message,
    x: (stageWidth - sprites.message.naturalWidth) / 2,
    y: stageHeight / 4,
    width: sprites.message.naturalWidth,
    height: sprites.message.naturalHeight,
  });
  layer.add(message);

  const pipeWidth = sprites.pipe.naturalWidth || 52;

  const scoreCtl = createScoreSystem({
    birdX: BIRD_X,
    pipeWidth,
    layer,
    digits: sprites.digits,
    stageWidth,
    sound,
    pipes,
    state,
  });

  let gameoverNode: KonvaImage | null = null;

  function handleGameOver(): void {
    gameoverNode = new KonvaImage({
      image: sprites.gameover,
      x: (stageWidth - sprites.gameover.naturalWidth) / 2,
      y: stageHeight / 3,
      width: sprites.gameover.naturalWidth,
      height: sprites.gameover.naturalHeight,
    });
    layer.add(gameoverNode);
    layer.batchDraw();
    state.gameOverAt = performance.now();

    if (!state.reportedGameOver) {
      state.reportedGameOver = true;
      postGameOver(state.score);
    }
  }

  /** Remet la scène à zéro pour une nouvelle partie (déclenché par un clic après game over). */
  function resetGame(): void {
    for (const pipe of pipes.list) {
      registry.killEntity(pipe.entity);
      pipe.topGroup.destroy();
      pipe.bottomGroup.destroy();
    }
    pipes.list = [];
    pipes.spawnTimer = 0;

    gameoverNode?.destroy();
    gameoverNode = null;

    const pos = registry.getEntityComponent(bird, new PositionComponent(0, 0)) as PositionComponent;
    const vel = registry.getEntityComponent(bird, new VelocityComponent(0)) as VelocityComponent;
    pos.x = BIRD_X;
    pos.y = stageHeight / 2;
    vel.vy = 0;
    birdNode.x(BIRD_X);
    birdNode.y(stageHeight / 2);
    birdNode.rotation(0);

    state.score = 0;
    state.gameOver = false;
    state.reportedGameOver = false;
    scoreCtl.resetDisplay();
  }

  function handleFlap(): void {
    if (state.gameOver) {
      if (performance.now() - state.gameOverAt < RESTART_COOLDOWN_MS) return;
      resetGame();
      state.running = true;
      sound.play('swoosh');
      flap(registry, bird);
      sound.play('wing');
      return;
    }
    if (!state.running) {
      state.running = true;
      message.destroy();
      sound.play('swoosh');
    }
    flap(registry, bird);
    sound.play('wing');
  }

  registry.addSystem(createInputSystem(input, handleFlap));
  registry.addSystem(createPhysicsSystem(bird, birdNode, state));
  registry.addSystem(
    createPipesSystem({
      layer,
      pipeImage: sprites.pipe,
      stageWidth,
      stageHeight,
      groundHeight: GROUND_HEIGHT,
      ground,
      pipes,
      state,
    })
  );
  registry.addSystem(
    createCollisionSystem({
      birdNode,
      groundY: stageHeight - GROUND_HEIGHT,
      pipes,
      sound,
      state,
      onGameOver: handleGameOver,
    })
  );
  registry.addSystem(scoreCtl.tick);
  registry.addSystem(() => {
    layer.batchDraw();
  });
}
