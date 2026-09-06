import { useAuth } from '../hooks/useAuth.jsx';
import Avatar from './Avatar.jsx';
import UserNameTag from './UserNameTag.jsx';
import type { GamblingSpectatorEntry } from '../types.js';

/** Barre "👀 N spectateurs" affichée sur les pages de jeux de gambling (caisses,
 * blackjack, crash, tower) — alimentée par useSpectators.ts (heartbeat de présence,
 * voir migration 049). N'affiche rien tant qu'il n'y a aucun spectateur, pour ne
 * pas polluer la page quand un joueur est seul sur le jeu. */
export default function SpectatorsList({ spectators }: { spectators: GamblingSpectatorEntry[] }) {
  const { user } = useAuth();

  if (spectators.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap text-sm text-zinc-400 mb-4">
      <span className="flex-shrink-0">
        👀 {spectators.length} spectateur{spectators.length > 1 ? 's' : ''} :
      </span>
      <div className="flex items-center gap-2 flex-wrap">
        {spectators.map((s) => (
          <span key={s.user_id} className="flex items-center gap-1.5">
            <Avatar
              username={s.username}
              avatarUrl={s.avatar_url}
              size={20}
              frameUrl={s.equipped_cosmetics.find((c) => c.slot === 'avatar_frame')?.image_url}
            />
            <UserNameTag
              username={s.user_id === user?.id ? 'Toi' : s.username}
              equipped={s.equipped_cosmetics}
              className="text-xs"
            />
          </span>
        ))}
      </div>
    </div>
  );
}
