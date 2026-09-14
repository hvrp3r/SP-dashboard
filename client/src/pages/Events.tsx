import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import * as eventsApi from '../api/events.js';
import * as speedrunApi from '../api/speedrun.js';
import { GAME_TYPE_LABELS, gameTypeLabel } from '../lib/eventLabels.js';
import {
  EVENT_GAME_TYPES,
  TOURNAMENT_FORMATS,
  type EventGameType,
  type EventSession,
  type SpeedrunComGameResult,
  type TournamentFormat,
} from '../types.js';

const SPEEDRUN_SEARCH_DEBOUNCE_MS = 400;

export default function Events() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [sessions, setSessions] = useState<EventSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const [gameType, setGameType] = useState<EventGameType>(EVENT_GAME_TYPES[0]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [entryFee, setEntryFee] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reward1st, setReward1st] = useState('');
  const [reward2nd, setReward2nd] = useState('');
  const [reward3rd, setReward3rd] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Spécifique tournoi
  const [tournamentFormat, setTournamentFormat] = useState<TournamentFormat>('single_elim');
  const [maxTeams, setMaxTeams] = useState('8');
  const [teamSize, setTeamSize] = useState('1');

  // Recherche speedrun.com — purement une pré-suggestion pour remplir titre/
  // description/image/lien ; le MSP garde toujours la main pour tout saisir à la
  // main sans jamais y toucher.
  const [speedrunQuery, setSpeedrunQuery] = useState('');
  const [speedrunResults, setSpeedrunResults] = useState<SpeedrunComGameResult[]>([]);
  const [speedrunSearching, setSpeedrunSearching] = useState(false);
  const [speedrunSearchError, setSpeedrunSearchError] = useState<string | null>(null);
  const [selectedGame, setSelectedGame] = useState<SpeedrunComGameResult | null>(null);
  const speedrunDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (gameType !== 'speedrun' || speedrunQuery.trim().length < 2) {
      setSpeedrunResults([]);
      return;
    }
    if (speedrunDebounceRef.current) clearTimeout(speedrunDebounceRef.current);
    speedrunDebounceRef.current = setTimeout(async () => {
      setSpeedrunSearching(true);
      setSpeedrunSearchError(null);
      try {
        const results = await speedrunApi.searchGames(speedrunQuery.trim());
        setSpeedrunResults(results);
      } catch (err) {
        setSpeedrunSearchError(err instanceof Error ? err.message : 'Recherche indisponible');
      } finally {
        setSpeedrunSearching(false);
      }
    }, SPEEDRUN_SEARCH_DEBOUNCE_MS);
    return () => {
      if (speedrunDebounceRef.current) clearTimeout(speedrunDebounceRef.current);
    };
  }, [gameType, speedrunQuery]);

  function handleSelectSpeedrunGame(game: SpeedrunComGameResult) {
    setSelectedGame(game);
    setTitle(game.name);
    setDescription(game.description);
    setSpeedrunQuery('');
    setSpeedrunResults([]);
  }

  async function load() {
    setLoading(true);
    try {
      const data = await eventsApi.listSessions();
      setSessions(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const openSessions = sessions.filter((s) => s.status === 'open');
  const closedSessions = sessions.filter((s) => s.status !== 'open');

  const showPaidOption = gameType === 'quiz';
  const paidFeeValue = showPaidOption && isPaid ? Number(entryFee) : NaN;
  const paidFeeInvalid = showPaidOption && isPaid && (!Number.isInteger(paidFeeValue) || paidFeeValue <= 0);

  const showDeadlineRewardOptions = gameType === 'flappy_bird' || gameType === 'speedrun';
  const reward1stValue = Number(reward1st);
  const reward2ndValue = Number(reward2nd);
  const reward3rdValue = Number(reward3rd);
  const endsAtDate = endsAt ? new Date(endsAt) : null;
  const deadlineRewardInvalid =
    showDeadlineRewardOptions &&
    (!endsAtDate ||
      Number.isNaN(endsAtDate.getTime()) ||
      endsAtDate <= new Date() ||
      !Number.isInteger(reward1stValue) ||
      reward1stValue < 0 ||
      !Number.isInteger(reward2ndValue) ||
      reward2ndValue < 0 ||
      !Number.isInteger(reward3rdValue) ||
      reward3rdValue < 0);

  const showTournamentOptions = gameType === 'tournament';
  const maxTeamsValue = Number(maxTeams);
  const teamSizeValue = Number(teamSize);
  const tournamentInvalid =
    showTournamentOptions &&
    (!Number.isInteger(maxTeamsValue) ||
      maxTeamsValue < 2 ||
      maxTeamsValue > 64 ||
      !Number.isInteger(teamSizeValue) ||
      teamSizeValue < 1 ||
      teamSizeValue > 16 ||
      !Number.isInteger(reward1stValue) ||
      reward1stValue < 0 ||
      !Number.isInteger(reward2ndValue) ||
      reward2ndValue < 0 ||
      !Number.isInteger(reward3rdValue) ||
      reward3rdValue < 0);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (paidFeeInvalid) {
      setError('La mise doit être un entier positif');
      return;
    }
    if (deadlineRewardInvalid) {
      setError('La date limite (dans le futur) et les 3 gains sont requis');
      return;
    }
    if (tournamentInvalid) {
      setError('Format, nombre d’équipes (2-64), taille d’équipe (1-16) et dotation requis');
      return;
    }
    setSubmitting(true);
    try {
      await eventsApi.createSession(
        gameType,
        title.trim(),
        description.trim() || undefined,
        showPaidOption && isPaid ? paidFeeValue : undefined,
        showDeadlineRewardOptions
          ? {
              endsAt: new Date(endsAt).toISOString(),
              reward1st: reward1stValue,
              reward2nd: reward2ndValue,
              reward3rd: reward3rdValue,
              gameImageUrl: gameType === 'speedrun' ? (selectedGame?.imageUrl ?? undefined) : undefined,
              gameExternalUrl: gameType === 'speedrun' ? (selectedGame?.weblink ?? undefined) : undefined,
            }
          : undefined,
        showTournamentOptions
          ? {
              tournamentFormat,
              tournamentMaxTeams: maxTeamsValue,
              tournamentTeamSize: teamSizeValue,
              reward1st: reward1stValue,
              reward2nd: reward2ndValue,
              reward3rd: reward3rdValue,
            }
          : undefined
      );
      setTitle('');
      setDescription('');
      setIsPaid(false);
      setEntryFee('');
      setEndsAt('');
      setReward1st('');
      setReward2nd('');
      setReward3rd('');
      setTournamentFormat('single_elim');
      setMaxTeams('8');
      setTeamSize('1');
      setSelectedGame(null);
      setSpeedrunQuery('');
      setSpeedrunResults([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-6">Événements</h1>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {isAdmin && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-6 mb-6">
            <h2 className="font-semibold text-zinc-200 mb-3">Créer une session</h2>
            <form onSubmit={handleCreate} className="space-y-2">
              <select
                value={gameType}
                onChange={(e) => {
                  const nextType = e.target.value as EventGameType;
                  setGameType(nextType);
                  if (nextType !== 'quiz') {
                    setIsPaid(false);
                    setEntryFee('');
                  }
                  if (nextType !== 'flappy_bird' && nextType !== 'speedrun' && nextType !== 'tournament') {
                    setEndsAt('');
                    setReward1st('');
                    setReward2nd('');
                    setReward3rd('');
                  }
                  if (nextType !== 'tournament') {
                    setTournamentFormat('single_elim');
                    setMaxTeams('8');
                    setTeamSize('1');
                  }
                  if (nextType !== 'speedrun') {
                    setSelectedGame(null);
                    setSpeedrunQuery('');
                    setSpeedrunResults([]);
                  }
                }}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {EVENT_GAME_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {GAME_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              {gameType === 'speedrun' && (
                <div className="relative space-y-2">
                  {selectedGame ? (
                    <div className="flex items-center gap-3 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2">
                      {selectedGame.imageUrl && (
                        <img
                          src={selectedGame.imageUrl}
                          alt=""
                          className="h-10 w-10 rounded object-cover flex-shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-zinc-100 truncate">{selectedGame.name}</p>
                        <a
                          href={selectedGame.weblink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-emerald-400 hover:underline"
                        >
                          Voir sur speedrun.com ↗
                        </a>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedGame(null)}
                        className="flex-shrink-0 text-xs text-zinc-500 hover:text-zinc-300"
                        title="Retirer le lien speedrun.com (titre et description restent modifiables à la main)"
                      >
                        Retirer
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        placeholder="Rechercher un jeu sur speedrun.com (optionnel)"
                        value={speedrunQuery}
                        onChange={(e) => setSpeedrunQuery(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      {speedrunSearching && (
                        <p className="text-xs text-zinc-500">Recherche…</p>
                      )}
                      {speedrunSearchError && (
                        <p className="text-xs text-red-400">{speedrunSearchError}</p>
                      )}
                      {speedrunResults.length > 0 && (
                        <div className="absolute z-10 w-full max-h-64 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
                          {speedrunResults.map((game) => (
                            <button
                              type="button"
                              key={game.id}
                              onClick={() => handleSelectSpeedrunGame(game)}
                              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-800 transition"
                            >
                              {game.imageUrl ? (
                                <img
                                  src={game.imageUrl}
                                  alt=""
                                  className="h-8 w-8 rounded object-cover flex-shrink-0"
                                />
                              ) : (
                                <div className="h-8 w-8 rounded bg-zinc-800 flex-shrink-0" />
                              )}
                              <span className="text-sm text-zinc-200 truncate">{game.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              <input
                type="text"
                required
                maxLength={255}
                placeholder={
                  gameType === 'tournament'
                    ? 'Titre (ex: Tournoi Flappy Bird — Saison 1)'
                    : 'Titre (ex: Quiz Culture Générale #3)'
                }
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <textarea
                placeholder="Description (optionnel)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {showPaidOption && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={isPaid}
                      onChange={(e) => setIsPaid(e.target.checked)}
                      className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500"
                    />
                    Payant
                  </label>
                  {isPaid && (
                    <input
                      type="number"
                      required
                      min={1}
                      step={1}
                      placeholder="Mise pour accéder au quiz (SP)"
                      value={entryFee}
                      onChange={(e) => setEntryFee(e.target.value)}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  )}
                </div>
              )}
              {showDeadlineRewardOptions && (
                <div className="space-y-2">
                  <label className="block text-xs text-zinc-500">Date limite</label>
                  <input
                    type="datetime-local"
                    required
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">1er (SP)</label>
                      <input
                        type="number"
                        required
                        min={0}
                        step={1}
                        value={reward1st}
                        onChange={(e) => setReward1st(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">2e (SP)</label>
                      <input
                        type="number"
                        required
                        min={0}
                        step={1}
                        value={reward2nd}
                        onChange={(e) => setReward2nd(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">3e (SP)</label>
                      <input
                        type="number"
                        required
                        min={0}
                        step={1}
                        value={reward3rd}
                        onChange={(e) => setReward3rd(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              )}
              {showTournamentOptions && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Format</label>
                    <select
                      value={tournamentFormat}
                      onChange={(e) => setTournamentFormat(e.target.value as TournamentFormat)}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      {TOURNAMENT_FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {f === 'single_elim'
                            ? 'Élimination directe'
                            : f === 'double_elim'
                              ? 'Double élimination'
                              : 'Round-robin (poule unique)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Nombre d’équipes (max)</label>
                      <input
                        type="number"
                        required
                        min={2}
                        max={64}
                        step={1}
                        value={maxTeams}
                        onChange={(e) => setMaxTeams(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">Joueurs par équipe</label>
                      <input
                        type="number"
                        required
                        min={1}
                        max={16}
                        step={1}
                        value={teamSize}
                        onChange={(e) => setTeamSize(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Dotation en SP par membre de l’équipe — distribuée automatiquement à la fin du
                    tournoi.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">1er (SP)</label>
                      <input
                        type="number"
                        required
                        min={0}
                        step={1}
                        value={reward1st}
                        onChange={(e) => setReward1st(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">2e (SP)</label>
                      <input
                        type="number"
                        required
                        min={0}
                        step={1}
                        value={reward2nd}
                        onChange={(e) => setReward2nd(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">3e (SP)</label>
                      <input
                        type="number"
                        required
                        min={0}
                        step={1}
                        value={reward3rd}
                        onChange={(e) => setReward3rd(e.target.value)}
                        className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </div>
              )}
              <button
                type="submit"
                disabled={submitting || paidFeeInvalid || deadlineRewardInvalid || tournamentInvalid}
                className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
              >
                Créer
              </button>
            </form>
          </div>
        )}

        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : (
          <>
            <div className="space-y-3">
              {openSessions.length === 0 ? (
                <p className="text-zinc-500">Aucun événement ouvert pour le moment.</p>
              ) : (
                openSessions.map((s) => <EventCard key={s.id} session={s} />)
              )}
            </div>

            {closedSessions.length > 0 && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowClosed((prev) => !prev)}
                  className="mb-3 text-sm text-zinc-400 hover:text-zinc-200 font-medium transition"
                >
                  {showClosed
                    ? 'Masquer les événements clôturés'
                    : `Voir les événements clôturés (${closedSessions.length})`}
                </button>
                {showClosed && (
                  <div className="space-y-3">
                    {closedSessions.map((s) => (
                      <EventCard key={s.id} session={s} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EventCard({ session: s }: { session: EventSession }) {
  return (
    <Link
      to={`/evenements/${s.id}`}
      className="flex items-start gap-3 bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 hover:border-emerald-500/50 transition"
    >
      {s.game_image_url && (
        <img
          src={s.game_image_url}
          alt=""
          className="h-10 w-10 rounded object-cover flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-medium text-zinc-100 truncate">{s.title}</p>
          <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium uppercase tracking-wide">
            {gameTypeLabel(s.game_type)}
          </span>
          {s.entry_fee && (
            <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium uppercase tracking-wide">
              {s.entry_fee} SP
            </span>
          )}
          {['flappy_bird', 'speedrun', 'tournament'].includes(s.game_type) && s.reward_1st ? (
            <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-medium uppercase tracking-wide">
              🥇 {s.reward_1st} SP
            </span>
          ) : null}
        </div>
        <span
          className={`flex-shrink-0 text-xs px-2 py-1 rounded-full ${
            s.status === 'open'
              ? 'bg-emerald-500/15 text-emerald-400'
              : s.status === 'cancelled'
                ? 'bg-red-500/15 text-red-400'
                : 'bg-zinc-800 text-zinc-400'
          }`}
        >
          {s.status === 'open' ? 'Ouvert' : s.status === 'cancelled' ? 'Annulé' : 'Clôturé'}
        </span>
      </div>
      {s.description && <p className="text-sm text-zinc-500">{s.description}</p>}
      </div>
    </Link>
  );
}
