import { type IRunOptions } from '@nanoforge-dev/common';
import { NanoforgeFactory } from '@nanoforge-dev/core';

import { AssetManagerLibrary } from '@nanoforge-dev/asset-manager';
import { ECSClientLibrary, type Registry } from '@nanoforge-dev/ecs-client';
import { Graphics2DLibrary, Layer } from '@nanoforge-dev/graphics-2d';
import { InputLibrary } from '@nanoforge-dev/input';
import { NetworkClientLibrary } from '@nanoforge-dev/network-client';

import { Background, Board, Cell } from './components/board.component.js';
import { MatchStatusComponent } from './components/match-status.component.js';
import { StatusText } from './components/ui.component.js';
import { packetHandler } from './systems/packet-handler.system.js';
import { inputSystem } from './systems/input.system.js';
import { boardRenderSystem } from './systems/board-render.system.js';

export const layer = new Layer();

const BOARD_SIZE = 500;

function createBoard(registry: Registry, x: number, y: number, size: number): void {
  const board = registry.spawnEntity();
  registry.addComponent(board, new Board(x, y, size));

  const padding = (size * 0.1) / 4;
  const caseSize = (size - padding * 4) / 3;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cell = registry.spawnEntity();
      registry.addComponent(
        cell,
        new Cell(
          row,
          col,
          x + padding * (col + 1) + caseSize * col,
          y + padding * (row + 1) + caseSize * row,
          caseSize
        )
      );
    }
  }
}

export async function main(options: IRunOptions): Promise<void> {
  const app = NanoforgeFactory.createClient({ tickRate: 60 });

  const assetManager = new AssetManagerLibrary();
  const ecs = new ECSClientLibrary();
  const graphics = new Graphics2DLibrary();
  const input = new InputLibrary();
  const network = new NetworkClientLibrary();

  app.useAssetManager(assetManager);
  app.useComponentSystem(ecs);
  app.useGraphics(graphics);
  app.useInput(input);
  app.useNetwork(network);

  await app.init(options);

  const registry = ecs.registry;
  graphics.stage.add(layer);

  const background = registry.spawnEntity();
  registry.addComponent(background, new Background(window.innerWidth, window.innerHeight));

  createBoard(
    registry,
    window.innerWidth / 2 - BOARD_SIZE / 2,
    window.innerHeight / 2 - BOARD_SIZE / 2 + 40,
    BOARD_SIZE
  );

  const statusEntity = registry.spawnEntity();
  registry.addComponent(
    statusEntity,
    new StatusText(window.innerWidth / 2, window.innerHeight / 2 - BOARD_SIZE / 2 - 40)
  );

  const matchStatus = new MatchStatusComponent();
  const matchEntity = registry.spawnEntity();
  registry.addComponent(matchEntity, matchStatus);

  registry.addSystem(packetHandler);
  registry.addSystem(inputSystem);
  registry.addSystem(boardRenderSystem);

  async function waitForConnection(): Promise<void> {
    if (network.tcp?.isConnected()) return;
    return new Promise((resolve) => {
      const check = () => {
        if (network.tcp.isConnected()) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
  }

  await waitForConnection();

  // Passé par TicTacToeEmbed.tsx dans l'URL de l'iframe — voir bridge.ts pour
  // parentOrigin (même mécanisme, lu séparément là où il sert).
  const token = new URLSearchParams(window.location.search).get('token');
  if (token) {
    network.tcp.sendData(new TextEncoder().encode(JSON.stringify({ type: 'joinMatch', token })));
  } else {
    matchStatus.error = 'Lien de partie invalide — relance depuis Points Sourires.';
  }

  await app.run();
}
