import { type Registry } from '@nanoforge-dev/ecs-server';
import { NetworkServerLibrary } from '@nanoforge-dev/network-server';
import { Context } from '@nanoforge-dev/common';
import { joinMatchPacketHandler } from './packet-handlers/join-match-packet.handler.js';
import { placeMarkPacketHandler } from './packet-handlers/place-mark-packet.handler.js';

export type PacketHandler = (
  client: number,
  packet: unknown,
  registry: Registry,
  ctx: Context
) => unknown;

export const packetHandlers: Map<string, PacketHandler> = new Map([
  ['joinMatch', joinMatchPacketHandler as PacketHandler],
  ['placeMark', placeMarkPacketHandler as PacketHandler],
]);

export function packetHandler(registry: Registry, ctx: Context): void {
  const network = ctx.libs.getNetwork<NetworkServerLibrary>();
  network.tcp.getReceivedPackets().forEach((packets, client) => {
    packets.forEach((packet) => {
      const data = JSON.parse(new TextDecoder().decode(packet));
      packetHandlers.get(data.type)?.(client, data, registry, ctx);
    });
  });
}
