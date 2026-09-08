import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useChatGameRoom } from '../hooks/useChatGameRoom.jsx';
import { useChatMessages } from '../hooks/useChatMessages.js';
import Avatar from './Avatar.jsx';
import UserNameTag from './UserNameTag.jsx';
import type { ChatRoom } from '../types.js';

const MAX_MESSAGE_LENGTH = 500;

const GLOBAL_TAB = { room: 'global' as ChatRoom, roomKey: '', label: 'Global', icon: '💬' };

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Chat en direct : un salon 'Global' toujours présent + un second onglet pour le
 * salon du jeu courant, annoncé par la page visitée via useAnnounceChatRoom (voir
 * useChatGameRoom.tsx) — Crash/Tower/Blackjack/caisse/session d'événement.
 * Sur très grand écran (2xl+, ≥1536px) : carte arrondie en pur survol, `position:
 * fixed` — ChatDock n'est jamais un élément de mise en page (pas de colonne grid/flex
 * qui contraindrait la largeur des pages, ce qui coupait les fonds plein cadre comme
 * ProfileBackdrop) : elle flotte simplement par-dessus, centrée dans la marge libre à
 * droite du contenu centré `max-w-4xl` (896px) des pages via un `right` calculé en
 * fonction du viewport (`calc(25vw - 24rem)`, voir desktopPositionClass — approximatif
 * de quelques px selon la barre de défilement, sans conséquence pour un simple survol).
 * `top: 50%` + `-translate-y-1/2` la centre verticalement ; étant `fixed`, elle reste
 * de toute façon visible en permanence pendant le scroll, sans dépendre du flux de la
 * page. En dessous de 2xl, la marge ne suffirait pas à la loger sans chevaucher le
 * contenu, donc elle retombe sur une bulle flottante ouvrable (comportement mobile
 * classique, indépendant de `collapsed` ci-dessous).
 * Sur desktop, `collapsed` fait glisser la carte hors-écran vers la droite
 * (`translate-x`, voir `desktopSlideClass`) plutôt que de la démonter — un onglet
 * fin `‹` reste alors collé au bord droit du viewport (`position: fixed`) pour la
 * ramener, avec un badge si des messages sont arrivés entre-temps (`unreadCount`,
 * basé sur `incomingCount` de useChatMessages — l'historique initial d'un salon ne
 * compte jamais comme "non lu", seuls les messages arrivés par sondage incrémental).
 */
export default function ChatDock() {
  const { user, equippedCosmetics } = useAuth();
  const gameRoom = useChatGameRoom();
  const [activeTab, setActiveTab] = useState<'global' | 'game'>('global');
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const unreadBaselineRef = useRef(0);
  // Distingue "nouveaux messages ajoutés en bas" (coller en bas, comportement
  // normal) de "historique plus ancien ajouté en haut" via loadOlder (préserver la
  // position visuelle plutôt que de sauter) — voir les deux useLayoutEffect plus bas.
  const prependingRef = useRef(false);
  const prevScrollHeightRef = useRef(0);

  const active = activeTab === 'game' && gameRoom ? gameRoom : GLOBAL_TAB;
  const { messages, error, send, incomingCount, hasMore, loadingMore, loadOlder } = useChatMessages(
    active.room,
    active.roomKey
  );

  // Bascule automatiquement sur le salon du jeu dès qu'une page en annonce un
  // (ex : on ouvre Crash), et revient sur Global dès qu'on le quitte.
  useEffect(() => {
    setActiveTab(gameRoom ? 'game' : 'global');
  }, [gameRoom?.room, gameRoom?.roomKey]);

  // Changer de salon repart d'un compteur à zéro (l'historique du nouveau salon
  // n'est pas "non lu", voir incomingCount dans useChatMessages).
  useEffect(() => {
    unreadBaselineRef.current = 0;
    setUnreadCount(0);
  }, [active.room, active.roomKey]);

  // Tant que le panneau (desktop, voir `collapsed`) est réduit, chaque message
  // arrivé par sondage incrémental incrémente le badge ; le rouvrir le remet à zéro.
  useEffect(() => {
    if (!collapsed) {
      unreadBaselineRef.current = incomingCount;
      setUnreadCount(0);
    } else {
      setUnreadCount(Math.max(0, incomingCount - unreadBaselineRef.current));
    }
  }, [incomingCount, collapsed]);

  // Coller en bas par défaut (nouveau message envoyé/reçu, ou changement de salon) —
  // sauf juste après un loadOlder, où l'effet du dessous reprend la main pour garder
  // la position de lecture au lieu de renvoyer en bas.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || prependingRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, active.room, active.roomKey]);

  async function handleLoadOlder() {
    const el = listRef.current;
    if (!el) return;
    prependingRef.current = true;
    prevScrollHeightRef.current = el.scrollHeight;
    await loadOlder();
  }

  // Une fois les messages plus anciens insérés en haut, la hauteur totale a grandi :
  // on décale scrollTop d'autant pour que le contenu déjà visible ne bouge pas
  // à l'écran (sinon la vue saute visuellement vers le bas relatif au nouveau contenu).
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !prependingRef.current) return;
    el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
    prependingRef.current = false;
  }, [messages]);

  if (!user) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await send(body);
      setDraft('');
    } catch {
      // Best effort : le brouillon reste, le joueur peut réessayer.
    } finally {
      setSending(false);
    }
  }

  const mobileOpenClasses = open
    ? 'fixed flex bottom-20 right-4 w-[calc(100vw-2rem)] max-w-sm h-[70vh]'
    : 'hidden';
  // Réduit = glisse hors-écran vers la droite (translate-x), plutôt que d'être
  // démonté/masqué — permet l'animation. body a overflow-x-hidden (index.css) pour
  // éviter toute barre de défilement horizontale pendant que la carte dépasse du
  // viewport.
  const desktopSlideClass = collapsed ? '2xl:translate-x-[130%]' : '2xl:translate-x-0';
  // `right` calculé plutôt qu'une valeur fixe : centre la carte dans la marge libre
  // à droite du contenu `max-w-4xl` (896px = 56rem, donc bord à 50vw + 28rem) plutôt
  // que de la coller au bord — voir le calcul détaillé dans le commentaire au-dessus
  // du composant. Tailwind exige `_` à la place des espaces dans les valeurs
  // arbitraires contenant calc().
  const desktopPositionClass = '2xl:fixed 2xl:top-1/2 2xl:-translate-y-1/2 2xl:right-[calc(25vw_-_24rem)]';

  return (
    <>
      <div
        className={`z-30 flex-col bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden ${mobileOpenClasses} 2xl:flex ${desktopPositionClass} 2xl:bottom-auto 2xl:left-auto ${desktopSlideClass} 2xl:transition-transform 2xl:duration-300 2xl:ease-in-out 2xl:w-80 2xl:h-[32rem] 2xl:max-w-none`}
        style={open ? { animation: 'fadeSlideIn 0.18s ease-out' } : undefined}
      >
        <div className="flex items-center border-b border-zinc-800 flex-shrink-0">
          <button
            onClick={() => setActiveTab('global')}
            className={`flex-1 px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
              activeTab === 'global' || !gameRoom
                ? 'text-emerald-400 border-b-2 border-emerald-400'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            💬 Global
          </button>
          {gameRoom && (
            <button
              onClick={() => setActiveTab('game')}
              className={`flex-1 px-3 py-2.5 text-sm font-medium transition-colors duration-150 truncate ${
                activeTab === 'game'
                  ? 'text-emerald-400 border-b-2 border-emerald-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {gameRoom.icon} {gameRoom.label}
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            aria-label="Fermer le chat"
            className="2xl:hidden px-3 py-2.5 text-zinc-500 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        {/* Flottant sur le bord droit, centré verticalement sur toute la carte
            (pas dans la rangée d'onglets) : évite de partager sa ligne avec le
            soulignement vert de l'onglet actif, et le rend bien plus visible qu'un
            simple texte gris perdu entre deux onglets. */}
        <button
          onClick={() => setCollapsed(true)}
          aria-label="Réduire le chat"
          title="Réduire le chat"
          className="hidden 2xl:flex absolute top-1/2 right-1.5 -translate-y-1/2 z-10 w-7 h-7 items-center justify-center rounded-full bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
        >
          {/* SVG plutôt que le glyphe texte "›" : son encrage n'est pas centré dans
              sa boîte de caractère selon la police, il paraissait toujours décalé
              malgré `items-center justify-center` sur le bouton. */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>

        <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
          {hasMore && (
            <div className="text-center pb-1">
              <button
                onClick={handleLoadOlder}
                disabled={loadingMore}
                className="text-xs font-medium text-zinc-500 hover:text-emerald-400 disabled:opacity-50 disabled:hover:text-zinc-500 transition-colors"
              >
                {loadingMore ? 'Chargement…' : 'Charger les messages précédents'}
              </button>
            </div>
          )}
          {messages.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center mt-4">
              Aucun message pour l'instant — sois le premier à écrire !
            </p>
          ) : (
            messages.map((m) => {
              const isSelf = m.user_id === user.id;
              return (
                <div key={m.id} className="flex items-start gap-2">
                  {/* Le décalage d'alignement va sur ce wrapper, pas sur le `className`
                      d'Avatar : ce dernier n'atteint que la photo, pas le cadre cosmétique
                      superposé en `<img>` séparée — appliqué directement sur Avatar, ça
                      décale la photo sans bouger le cadre autour, qui se retrouve mal placé. */}
                  <div className="mt-0.5 flex-shrink-0">
                    <Avatar
                      username={m.username}
                      avatarUrl={m.avatar_url}
                      size={24}
                      frameUrl={m.equipped_cosmetics.find((c) => c.slot === 'avatar_frame')?.image_url}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <UserNameTag
                        username={isSelf ? 'Toi' : m.username}
                        equipped={isSelf ? equippedCosmetics : m.equipped_cosmetics}
                        className="text-xs"
                      />
                      <span className="text-[10px] text-zinc-600 flex-shrink-0">
                        {formatTime(m.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-200 break-words whitespace-pre-line">{m.body}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {error && <p className="px-3 pb-1 text-xs text-red-400">{error}</p>}

        <form onSubmit={handleSubmit} className="flex items-center gap-2 p-2 border-t border-zinc-800 flex-shrink-0">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="Écrire un message…"
            className="flex-1 min-w-0 bg-zinc-800 text-zinc-100 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500/50 placeholder:text-zinc-500"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            className="flex-shrink-0 px-3 py-2 rounded-lg bg-emerald-500 text-zinc-950 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-transform hover:scale-105 active:scale-95"
          >
            ➤
          </button>
        </form>
      </div>

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Afficher le chat"
          title="Afficher le chat"
          className="hidden 2xl:flex fixed top-1/2 right-0 -translate-y-1/2 z-30 items-center justify-center w-7 h-14 rounded-l-xl bg-zinc-900 border border-r-0 border-zinc-800 shadow-2xl shadow-black/40 text-zinc-300 text-lg hover:text-zinc-100 hover:w-9 transition-all duration-150"
          style={{ animation: 'fadeSlideIn 0.18s ease-out' }}
        >
          ‹
          {unreadCount > 0 && (
            <span
              key={unreadCount > 9 ? '9+' : unreadCount}
              className="absolute -top-2 -left-2 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
              style={{ animation: 'popIn 0.3s ease-out' }}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Fermer le chat' : 'Ouvrir le chat'}
        className="2xl:hidden fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full bg-emerald-500 text-zinc-950 text-xl shadow-lg shadow-black/40 flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
      >
        {open ? '✕' : '💬'}
      </button>
    </>
  );
}
