import { type Registry } from '@nanoforge-dev/ecs-client';
import { MatchStatusComponent } from '../../components/match-status.component.js';

interface ErrorPacket {
  type: 'error';
  message: string;
}

export function errorPacketHandler(packet: ErrorPacket, registry: Registry): void {
  const entities: { MatchStatusComponent: MatchStatusComponent }[] = registry.getZipper([
    MatchStatusComponent,
  ]);
  const match = entities[0]?.MatchStatusComponent;
  if (!match) return;
  match.error = packet.message;
}
