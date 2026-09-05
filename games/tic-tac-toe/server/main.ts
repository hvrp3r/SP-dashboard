import { type IRunOptions } from '@nanoforge-dev/common';
import { NanoforgeFactory } from '@nanoforge-dev/core';
import { AssetManagerLibrary } from '@nanoforge-dev/asset-manager';
import { ECSServerLibrary } from '@nanoforge-dev/ecs-server';
import { NetworkServerLibrary } from '@nanoforge-dev/network-server';
import { packetHandler } from './systems/packet-handler.system.js';

/** 0 = vide, 1 = X, 2 = O — dupliqué côté client (board.component.ts#Mark), pas
 * de module partagé entre client/server (même convention que les exemples officiels
 * NanoForge, ex: pong-network, qui redéfinissent Position/Velocity des deux côtés).
 * `enum` classique et non `const enum` : `isolatedModules` (tsconfig) interdit les
 * const enum, chaque fichier devant pouvoir être transpilé indépendamment. */
export enum Mark {
  Empty = 0,
  X = 1,
  O = 2,
}

export interface MatchPlayer {
  userId: number;
  username: string;
  clientId: number;
  symbol: Mark.X | Mark.O;
}

export interface MatchRoom {
  challengeId: number;
  players: MatchPlayer[];
  board: Mark[];
  turn: Mark.X | Mark.O;
  /** Marque qui a ouvert la manche en cours — alterne à chaque égalité (voir
   * place-mark-packet.handler.ts) pour ne pas toujours avantager le même joueur. */
  roundStartMark: Mark.X | Mark.O;
  round: number;
  status: 'waiting' | 'playing' | 'won';
  winnerUserId: number | null;
  winnerMark: Mark.X | Mark.O | null;
}

/**
 * Une partie par défi ('accepted') SP, jamais un lobby public façon raid-survival —
 * le token (voir join-match-packet.handler.ts) porte déjà le challengeId, donc pas
 * besoin de laisser les joueurs choisir/parcourir une salle.
 */
export const matches = new Map<number, MatchRoom>();

export async function main(options: IRunOptions): Promise<void> {
  const app = NanoforgeFactory.createServer();

  const assetManager = new AssetManagerLibrary();
  const ecsLibrary = new ECSServerLibrary();
  const network = new NetworkServerLibrary();

  app.useAssetManager(assetManager);
  app.useComponentSystem(ecsLibrary);
  app.useNetwork(network);

  await app.init(options);

  const registry = ecsLibrary.registry;
  registry.addSystem(packetHandler);

  await app.run();
}
