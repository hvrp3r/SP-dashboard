import { type Registry } from '@nanoforge-dev/ecs-client';
import { NetworkClientLibrary } from '@nanoforge-dev/network-client';
import { Context } from '@nanoforge-dev/common';
import { matchStatePacketHandler } from './packet-handlers/match-state-packet.handler.js';
import { errorPacketHandler } from './packet-handlers/error-packet.handler.js';

export type PacketHandler = (packet: unknown, registry: Registry, ctx: Context) => unknown;

export const packetHandlers: Map<string, PacketHandler> = new Map([
  ['matchState', matchStatePacketHandler as PacketHandler],
  ['error', errorPacketHandler as PacketHandler],
]);

export function packetHandler(registry: Registry, ctx: Context): void {
  const network = ctx.libs.getNetwork<NetworkClientLibrary>();
  const jsonPackets = network.tcp
    .getReceivedPackets()
    .map((packet: AllowSharedBufferSource | undefined) => JSON.parse(new TextDecoder().decode(packet)));

  if (!jsonPackets || jsonPackets.length === 0) return;
  jsonPackets.forEach((packet) => {
    packetHandlers.get(packet.type)?.(packet, registry, ctx);
  });
}
