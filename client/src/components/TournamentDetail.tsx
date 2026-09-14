import { useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useConfirm } from '../hooks/useConfirm.jsx';
import * as eventsApi from '../api/events.js';
import * as tournamentApi from '../api/tournament.js';
import { resolveAvatarUrl } from '../lib/avatar.js';
import { tournamentFormatLabel } from '../lib/eventLabels.js';
import type {
  EventSessionDetail,
  TournamentMatch,
  TournamentStandings,
  TournamentTeam,
} from '../types.js';

interface Props {
  sessionId: number;
  session: EventSessionDetail;
  isAdmin: boolean;
  userId?: number;
  onSessionChange: (session: EventSessionDetail) => void;
  onError: (error: string | null) => void;
}

const ROUND_LABELS_FROM_FINAL = [
  'Finale',
  'Demi-finales',
  'Quarts de finale',
  '8es de finale',
  '16es de finale',
  '32es de finale',
];

function roundLabel(round: number, totalRounds: number): string {
  return ROUND_LABELS_FROM_FINAL[totalRounds - round] ?? `Tour ${round}`;
}

export default function TournamentDetail({
  sessionId,
  session,
  isAdmin,
  userId,
  onSessionChange,
  onError,
}: Props) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const teams = session.teams ?? [];
  const matches = session.matches ?? [];
  const participants = session.participants ?? [];
  const state = session.tournament ?? {
    bracketGenerated: false,
    finished: false,
    championTeamId: null,
    standings: [],
  };

  const totalRounds =
    session.tournament_format === 'round_robin'
      ? 0
      : Math.max(0, ...matches.filter((m) => m.bracket === 'main' || m.bracket === 'winners').map((m) => m.round));

  const myParticipant = participants.find((p) => p.user_id === userId) ?? null;
  const capacity = (session.tournament_max_teams ?? 0) * (session.tournament_team_size ?? 1);
  const spotsLeft = capacity - participants.length;
  const champion = state.championTeamId != null ? teams.find((t) => t.id === state.championTeamId) : null;
  const canJoin =
    !!userId &&
    !myParticipant &&
    session.status === 'open' &&
    !state.finished &&
    spotsLeft > 0;

  const resolvedCount = matches.filter((m) => m.winner_team_id != null).length;

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    onError(null);
    try {
      return await action();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    setBusy(true);
    onError(null);
    try {
      const data = await eventsApi.joinSession(sessionId);
      onSessionChange(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <TournamentInfoBar session={session} state={state} participants={participants} />

      {canJoin && (
        <button
          onClick={handleJoin}
          disabled={busy}
          className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
        >
          {session.entry_fee
            ? `Rejoindre le tournoi (-${session.entry_fee} SP)`
            : 'Rejoindre le tournoi'}
        </button>
      )}
      {myParticipant && !state.finished && (
        <p className="text-sm text-emerald-400">
          {myParticipant.rating != null
            ? `Inscrit — rating de pondération : ${myParticipant.rating}`
            : 'Inscrit — ton rating de pondération sera ton solde SP au moment du tirage.'}
        </p>
      )}

      {champion && (
        <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-center">
          <p className="text-lg font-bold text-yellow-300">
            🏆 [{champion.tag}] remporte le tournoi
          </p>
          <p className="text-sm text-zinc-400">
            {champion.members.map((m) => m.username).join(', ')}
          </p>
        </div>
      )}

      {state.bracketGenerated ? (
        <>
          <BracketSection
            session={session}
            matches={matches}
            isAdmin={isAdmin}
            busy={busy}
            onResolve={async (matchId, winnerTeamId) => {
              const data = await run(() => tournamentApi.resolveMatch(sessionId, matchId, winnerTeamId));
              if (data) onSessionChange(data);
            }}
          />
          {isAdmin && !state.finished && (
            <ResetBracketButton
              disabled={busy || resolvedCount > 0}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Réinitialiser l’arbre',
                  message:
                    resolvedCount > 0
                      ? 'Au moins un match a déjà été joué : la réinitialisation est bloquée pour préserver l’historique.'
                      : 'Tous les matchs générés seront supprimés. Les équipes resteront modifiables.',
                  confirmLabel: 'Réinitialiser',
                  danger: true,
                });
                if (!ok) return;
                const data = await run(() => tournamentApi.resetBracket(sessionId));
                if (data) onSessionChange(data);
              }}
            />
          )}
        </>
      ) : (
        <TeamSetupSection
          sessionId={sessionId}
          session={session}
          teams={teams}
          participants={participants}
          isAdmin={isAdmin}
          busy={busy}
          onError={onError}
          run={run}
          onSessionChange={onSessionChange}
        />
      )}

      <ParticipantsSection
        participants={participants}
        teams={teams}
        isAdmin={isAdmin}
        busy={busy}
        onSetRating={async (userIdTarget, rating) => {
          const data = await run(() => tournamentApi.setParticipantRating(sessionId, userIdTarget, rating));
          if (data) onSessionChange(data);
        }}
      />

      <AnnouncementsSection
        sessionId={sessionId}
        session={session}
        isAdmin={isAdmin}
        busy={busy}
        run={run}
        onSessionChange={onSessionChange}
      />

      {isAdmin && (
        <AdminWrapUpSection
          participants={participants}
          busy={busy}
          onAward={async (awards) => {
            const data = await run(() => eventsApi.awardParticipants(sessionId, awards));
            if (data) onSessionChange(data);
          }}
          onClose={async () => {
            const ok = await confirm({
              title: 'Clôturer la session',
              message: 'Plus aucune annonce ni attribution ne sera possible.',
              confirmLabel: 'Clôturer',
              danger: true,
            });
            if (!ok) return;
            const data = await run(() => eventsApi.closeSession(sessionId));
            if (data) onSessionChange(data);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bandeau info
// ---------------------------------------------------------------------------

function TournamentInfoBar({
  session,
  state,
  participants,
}: {
  session: EventSessionDetail;
  state: NonNullable<EventSessionDetail['tournament']>;
  participants: NonNullable<EventSessionDetail['participants']>;
}) {
  const capacity = (session.tournament_max_teams ?? 0) * (session.tournament_team_size ?? 1);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Format</p>
        <p className="text-zinc-200">
          {tournamentFormatLabel(session.tournament_format ?? 'single_elim')}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Équipes</p>
        <p className="text-zinc-200">
          {(session.tournament_max_teams ?? 0)} max × {session.tournament_team_size ?? 1} joueur
          {(session.tournament_team_size ?? 1) > 1 ? 's' : ''}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Inscrits</p>
        <p className="text-zinc-200">
          {participants.length}/{capacity}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Dotation / membre</p>
        <p className="text-zinc-200">
          🥇 {session.reward_1st ?? 0} · 🥈 {session.reward_2nd ?? 0} · 🥉 {session.reward_3rd ?? 0} SP
        </p>
      </div>
      {state.bracketGenerated && (
        <div className="col-span-2 sm:col-span-4">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">État de l’arbre</p>
          <p className={state.finished ? 'text-yellow-300' : 'text-emerald-400'}>
            {state.finished ? 'Tournoi terminé' : 'Tournoi en cours'}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Équipes & configuration (avant génération de l'arbre)
// ---------------------------------------------------------------------------

interface TeamSetupProps {
  sessionId: number;
  session: EventSessionDetail;
  teams: TournamentTeam[];
  participants: NonNullable<EventSessionDetail['participants']>;
  isAdmin: boolean;
  busy: boolean;
  onError: (error: string | null) => void;
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  onSessionChange: (session: EventSessionDetail) => void;
}

function TeamSetupSection({
  sessionId,
  session,
  teams,
  participants,
  isAdmin,
  busy,
  onError,
  run,
  onSessionChange,
}: TeamSetupProps) {
  const [newTag, setNewTag] = useState('');
  const [newLogo, setNewLogo] = useState<File | null>(null);
  const [autoTeamCount, setAutoTeamCount] = useState('');

  const teamSize = session.tournament_team_size ?? 1;
  const maxTeams = session.tournament_max_teams ?? 2;
  const membersByUser = new Map<number, number>();
  for (const team of teams) {
    for (const m of team.members) membersByUser.set(m.user_id, team.id);
  }
  const unassigned = participants.filter((p) => !membersByUser.has(p.user_id));
  const canManage = isAdmin && session.status === 'open';

  async function handleCreateTeam() {
    const tag = newTag.trim();
    if (!tag) return;
    const data = await run(() => tournamentApi.createTeam(sessionId, tag, newLogo));
    if (data) {
      onSessionChange(data);
      setNewTag('');
      setNewLogo(null);
    }
  }

  async function handleAutoTeams() {
    const parsed = autoTeamCount.trim() ? Number(autoTeamCount.trim()) : undefined;
    if (parsed !== undefined && (!Number.isInteger(parsed) || parsed < 2)) {
      onError('Le nombre d’équipes doit être un entier ≥ 2');
      return;
    }
    const data = await run(() => tournamentApi.autoGenerateTeams(sessionId, parsed));
    if (data) onSessionChange(data);
  }

  async function handleGenerateBracket() {
    const data = await run(() => tournamentApi.generateBracket(sessionId));
    if (data) onSessionChange(data);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-zinc-200">
          Équipes <span className="text-sm text-zinc-500">({teams.length}/{maxTeams})</span>
        </h2>
      </div>

      {teams.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Aucune équipe pour le moment — attends que le MSP forme les équipes après les
          inscriptions.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              sessionId={sessionId}
              team={team}
              teamSize={teamSize}
              canManage={canManage}
              busy={busy}
              run={run}
              onSessionChange={onSessionChange}
              unassigned={unassigned}
            />
          ))}
        </div>
      )}

      {canManage && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-zinc-300">Panel MSP — composition</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              maxLength={8}
              placeholder="Tag (ex: SPFC, max 8 caractères)"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <label className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-950 text-zinc-400 px-3 py-2 text-sm hover:text-zinc-200 transition">
              {newLogo ? newLogo.name : 'Logo (optionnel)'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => setNewLogo(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              onClick={handleCreateTeam}
              disabled={busy || !newTag.trim() || teams.length >= maxTeams}
              className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
            >
              Créer
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
            <div className="flex-1">
              <label className="block text-xs text-zinc-500 mb-1">
                Génération aléatoire équilibrée — nombre d’équipes (vide = taille prévue : {maxTeams})
              </label>
              <input
                type="number"
                min={2}
                step={1}
                placeholder={String(maxTeams)}
                value={autoTeamCount}
                onChange={(e) => setAutoTeamCount(e.target.value)}
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <button
              type="button"
              onClick={handleAutoTeams}
              disabled={busy || unassigned.length === 0}
              className="bg-zinc-700 hover:bg-zinc-600 text-zinc-100 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
            >
              🎲 Générer les équipes
            </button>
          </div>
          {unassigned.length > 0 && (
            <p className="text-xs text-zinc-500">
              {unassigned.length} inscrit
              {unassigned.length > 1 ? 's' : ''} sans équipe. La pondération utilise le rating MSP,
              sinon le solde SP.
            </p>
          )}

          <div className="pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={handleGenerateBracket}
              disabled={busy || teams.length < 2}
              title={teams.length < 2 ? 'Crée au moins 2 équipes (ou génère-les)' : undefined}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
            >
              🏁 Générer l’arbre ({session.tournament_format === 'round_robin'
                ? 'poule unique'
                : session.tournament_format === 'double_elim'
                  ? 'double élimination'
                  : 'élimination directe'}
              )
            </button>
            <p className="mt-2 text-xs text-zinc-500">
              Une fois l’arbre généré, les équipes sont figées : réinitialise l’arbre pour les
              modifier.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function TeamCard({
  sessionId,
  team,
  teamSize,
  canManage,
  busy,
  run,
  onSessionChange,
  unassigned,
}: {
  sessionId: number;
  team: TournamentTeam;
  teamSize: number;
  canManage: boolean;
  busy: boolean;
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  onSessionChange: (session: EventSessionDetail) => void;
  unassigned: NonNullable<EventSessionDetail['participants']>;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [tag, setTag] = useState(team.tag);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [selectedUser, setSelectedUser] = useState('');

  const logo = resolveAvatarUrl(team.logo_url);

  async function handleSave() {
    const data = await run(() =>
      tournamentApi.updateTeam(sessionId, team.id, {
        tag: tag.trim(),
        logoFile: logoFile ?? undefined,
      })
    );
    if (data) {
      onSessionChange(data);
      setEditing(false);
      setLogoFile(null);
    }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: 'Supprimer l’équipe',
      message: `L'équipe [${team.tag}] et ses membres seront retirés.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    const data = await run(() => tournamentApi.deleteTeam(sessionId, team.id));
    if (data) onSessionChange(data);
  }

  async function handleRemoveLogo() {
    const data = await run(() => tournamentApi.updateTeam(sessionId, team.id, { removeLogo: true }));
    if (data) onSessionChange(data);
  }

  async function handleAddMember() {
    if (!selectedUser) return;
    const data = await run(() => tournamentApi.addTeamMember(sessionId, team.id, Number(selectedUser)));
    if (data) {
      onSessionChange(data);
      setSelectedUser('');
    }
  }

  async function handleRemoveMember(userId: number) {
    const data = await run(() => tournamentApi.removeTeamMember(sessionId, team.id, userId));
    if (data) onSessionChange(data);
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center gap-3 mb-3">
        {logo ? (
          <img src={logo} alt="" className="h-10 w-10 rounded object-cover flex-shrink-0" />
        ) : (
          <div className="h-10 w-10 rounded bg-zinc-800 flex items-center justify-center text-zinc-500 flex-shrink-0">
            🛡️
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-bold text-zinc-100 truncate">[{team.tag}]</p>
          <p className="text-xs text-zinc-500">
            {team.members.length}/{teamSize} membre{teamSize > 1 ? 's' : ''}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                setTag(team.tag);
                setEditing((prev) => !prev);
              }}
              disabled={busy}
              className="text-xs text-zinc-500 hover:text-zinc-200 transition px-1"
              title="Renommer / changer le logo"
            >
              ✏️
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="text-xs text-zinc-500 hover:text-red-400 transition px-1"
              title="Supprimer l'équipe"
            >
              🗑️
            </button>
          </div>
        )}
      </div>

      {editing && canManage && (
        <div className="mb-3 space-y-2 rounded-lg border border-zinc-700 p-3">
          <input
            type="text"
            maxLength={8}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <div className="flex items-center gap-2">
            <label className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200 transition">
              {logoFile ? logoFile.name : 'Nouveau logo…'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {team.logo_url && !logoFile && (
              <button type="button" onClick={handleRemoveLogo} className="text-xs text-zinc-500 hover:text-red-400">
                Retirer le logo
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={busy || !tag.trim()}
              className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-sm font-semibold px-3 py-1.5 rounded-md disabled:opacity-50"
            >
              Enregistrer
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-sm text-zinc-400 hover:text-zinc-200 px-2"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-1">
        {team.members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-2 text-sm">
            {m.avatar_url && (
              <img
                src={resolveAvatarUrl(m.avatar_url) ?? ''}
                alt=""
                className="h-5 w-5 rounded-full object-cover"
              />
            )}
            <span className="text-zinc-300 truncate">{m.username}</span>
            {canManage && (
              <button
                type="button"
                onClick={() => handleRemoveMember(m.user_id)}
                disabled={busy}
                className="ml-auto text-xs text-zinc-600 hover:text-red-400 transition"
                title="Retirer de l'équipe"
              >
                ✕
              </button>
            )}
          </li>
        ))}
        {team.members.length === 0 && <li className="text-xs text-zinc-600">Équipe vide</li>}
      </ul>

      {canManage && team.members.length < teamSize && unassigned.length > 0 && (
        <div className="mt-3 flex gap-2">
          <select
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">Ajouter un inscrit…</option>
            {unassigned.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.username}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAddMember}
            disabled={busy || !selectedUser}
            className="bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm font-semibold px-3 py-1.5 rounded-md disabled:opacity-50"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
}

function ResetBracketButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full text-sm text-zinc-500 hover:text-zinc-300 transition disabled:opacity-40"
    >
      Réinitialiser l’arbre (aucun match joué)
    </button>
  );
}

// ---------------------------------------------------------------------------
// Arbre / poule
// ---------------------------------------------------------------------------

interface BracketSectionProps {
  session: EventSessionDetail;
  matches: TournamentMatch[];
  isAdmin: boolean;
  busy: boolean;
  onResolve: (matchId: number, winnerTeamId: number) => Promise<void>;
}

function BracketSection({ session, matches, isAdmin, busy, onResolve }: BracketSectionProps) {
  const format = session.tournament_format ?? 'single_elim';
  if (format === 'round_robin') {
    return (
      <RoundRobinView matches={matches} standings={session.tournament?.standings ?? []} isAdmin={isAdmin} busy={busy} onResolve={onResolve} />
    );
  }

  const winners = matches.filter((m) => m.bracket === 'winners' || m.bracket === 'main');
  const losers = matches.filter((m) => m.bracket === 'losers');
  const grandFinals = matches.filter(
    (m) => m.bracket === 'grand_final' || m.bracket === 'grand_final_reset'
  );
  const isDouble = format === 'double_elim';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold text-zinc-200 mb-3">
          {isDouble ? 'Bracket des vainqueurs' : 'Arbre du tournoi'}
        </h2>
        <BracketRounds matches={winners} isAdmin={isAdmin} busy={busy} onResolve={onResolve} />
      </div>

      {isDouble && losers.length > 0 && (
        <div>
          <h2 className="font-semibold text-zinc-200 mb-3">Bracket des perdants</h2>
          <BracketRounds matches={losers} isAdmin={isAdmin} busy={busy} onResolve={onResolve} />
        </div>
      )}

      {isDouble && grandFinals.length > 0 && (
        <div>
          <h2 className="font-semibold text-zinc-200 mb-3">Grande finale</h2>
          <div className="space-y-3">
            {grandFinals.map((m) => (
              <MatchCard key={m.id} match={m} isAdmin={isAdmin} busy={busy} onResolve={onResolve} titleOverride="Grande finale" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BracketRounds({
  matches,
  isAdmin,
  busy,
  onResolve,
}: {
  matches: TournamentMatch[];
  isAdmin: boolean;
  busy: boolean;
  onResolve: (matchId: number, winnerTeamId: number) => Promise<void>;
}) {
  const rounds = useMemo(() => {
    const map = new Map<number, TournamentMatch[]>();
    for (const m of matches) {
      const list = map.get(m.round) ?? [];
      list.push(m);
      map.set(m.round, list);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [matches]);
  const totalRounds = rounds.length > 0 ? rounds[rounds.length - 1]![0] : 0;

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {rounds.map(([round, roundMatches]) => (
        <div key={round} className="min-w-[220px] flex-shrink-0">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
            {roundLabel(round, totalRounds)}
          </p>
          <div className="space-y-3">
            {roundMatches.map((m) => (
              <MatchCard key={m.id} match={m} isAdmin={isAdmin} busy={busy} onResolve={onResolve} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchCard({
  match,
  isAdmin,
  busy,
  onResolve,
  titleOverride,
}: {
  match: TournamentMatch;
  isAdmin: boolean;
  busy: boolean;
  onResolve: (matchId: number, winnerTeamId: number) => Promise<void>;
  titleOverride?: string;
}) {
  const resolvable = isAdmin && !busy && !match.winner_team_id && match.team_a != null && match.team_b != null;
  const isBye = match.winner_team_id != null && (match.team_a == null || match.team_b == null);
  const label = titleOverride ?? `Match ${match.position}`;

  return (
    <div
      className={`rounded-lg border p-3 ${
        match.winner_team_id
          ? 'border-zinc-800 bg-zinc-900/60'
          : 'border-emerald-500/30 bg-zinc-900'
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide text-zinc-600 mb-2">
        {label}
        {isBye ? ' — bye' : ''}
      </p>
      {[match.team_a, match.team_b].map((team, idx) => {
        const isWinner = team != null && match.winner_team_id === team.id;
        return (
          <div
            key={idx}
            className={`flex items-center gap-2 py-1 ${
              team == null ? 'text-zinc-700' : isWinner ? 'text-emerald-400 font-semibold' : 'text-zinc-300'
            }`}
          >
            {team ? (
              <>
                {team.logo_url && (
                  <img
                    src={resolveAvatarUrl(team.logo_url) ?? ''}
                    alt=""
                    className="h-5 w-5 rounded object-cover"
                  />
                )}
                <span className="truncate">[{team.tag}]</span>
                {isWinner && <span>✓</span>}
                {resolvable && (
                  <button
                    type="button"
                    onClick={() => onResolve(match.id, team.id)}
                    className="ml-auto text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30 transition"
                    title="Déclarer cette équipe vainqueur"
                  >
                    Gagnant
                  </button>
                )}
              </>
            ) : (
              <span className="italic">À déterminer</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RoundRobinView({
  matches,
  standings,
  isAdmin,
  busy,
  onResolve,
}: {
  matches: TournamentMatch[];
  standings: TournamentStandings[];
  isAdmin: boolean;
  busy: boolean;
  onResolve: (matchId: number, winnerTeamId: number) => Promise<void>;
}) {
  const days = useMemo(() => {
    const map = new Map<number, TournamentMatch[]>();
    for (const m of matches) {
      const list = map.get(m.round) ?? [];
      list.push(m);
      map.set(m.round, list);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [matches]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold text-zinc-200 mb-3">Matchs par journée</h2>
        <div className="space-y-4">
          {days.map(([day, dayMatches]) => (
            <div key={day}>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">
                Journée {day}
              </p>
              <div className="space-y-3">
                {dayMatches.map((m) => (
                  <MatchCard key={m.id} match={m} isAdmin={isAdmin} busy={busy} onResolve={onResolve} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {standings.length > 0 && (
        <div>
          <h2 className="font-semibold text-zinc-200 mb-3">Classement</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-zinc-500">
                <th className="pb-2">#</th>
                <th className="pb-2">Équipe</th>
                <th className="pb-2 text-center">V</th>
                <th className="pb-2 text-center">D</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s, idx) => (
                <tr key={s.team_id} className="border-t border-zinc-800">
                  <td className="py-2 text-zinc-500">{idx + 1}</td>
                  <td className="py-2">
                    <span className="flex items-center gap-2 text-zinc-200">
                      {s.logo_url && (
                        <img
                          src={resolveAvatarUrl(s.logo_url) ?? ''}
                          alt=""
                          className="h-5 w-5 rounded object-cover"
                        />
                      )}
                      [{s.tag}]
                    </span>
                  </td>
                  <td className="py-2 text-center text-emerald-400 font-semibold">{s.wins}</td>
                  <td className="py-2 text-center text-zinc-500">{s.losses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

function ParticipantsSection({
  participants,
  teams,
  isAdmin,
  busy,
  onSetRating,
}: {
  participants: NonNullable<EventSessionDetail['participants']>;
  teams: TournamentTeam[];
  isAdmin: boolean;
  busy: boolean;
  onSetRating: (userId: number, rating: number | null) => Promise<void>;
}) {
  const [editingRating, setEditingRating] = useState<Record<number, string>>({});
  const membersByUser = new Map<number, string>();
  for (const team of teams) {
    for (const m of team.members) membersByUser.set(m.user_id, team.tag);
  }

  if (participants.length === 0) {
    return <p className="text-sm text-zinc-500">Aucun inscrit pour le moment.</p>;
  }

  return (
    <div>
      <h2 className="font-semibold text-zinc-200 mb-3">
        Inscrits <span className="text-sm text-zinc-500">({participants.length})</span>
      </h2>
      <ul className="space-y-1">
        {participants.map((p) => (
          <li
            key={p.user_id}
            className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2"
          >
            {p.avatar_url && (
              <img
                src={resolveAvatarUrl(p.avatar_url) ?? ''}
                alt=""
                className="h-6 w-6 rounded-full object-cover"
              />
            )}
            <span className="text-sm text-zinc-200 truncate">{p.username}</span>
            {membersByUser.has(p.user_id) && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 uppercase tracking-wide">
                [{membersByUser.get(p.user_id)}]
              </span>
            )}
            <span className="ml-auto text-xs text-zinc-500">
              {p.rating != null ? `Rating : ${p.rating}` : 'Rating : solde SP'}
            </span>
            {isAdmin && (
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  step={1}
                  placeholder="rating"
                  value={editingRating[p.user_id] ?? ''}
                  onChange={(e) => setEditingRating((prev) => ({ ...prev, [p.user_id]: e.target.value }))}
                  className="w-20 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const raw = (editingRating[p.user_id] ?? '').trim();
                    const rating = raw ? Number(raw) : null;
                    if (raw && (!Number.isInteger(rating) || (rating as number) < 0)) return;
                    onSetRating(p.user_id, rating);
                  }}
                  className="text-xs text-zinc-500 hover:text-emerald-400 transition"
                >
                  ✓
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Annonces
// ---------------------------------------------------------------------------

function AnnouncementsSection({
  sessionId,
  session,
  isAdmin,
  busy,
  run,
  onSessionChange,
}: {
  sessionId: number;
  session: EventSessionDetail;
  isAdmin: boolean;
  busy: boolean;
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  onSessionChange: (session: EventSessionDetail) => void;
}) {
  const [body, setBody] = useState('');
  const announcements = session.announcements ?? [];

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    const data = await run(() => tournamentApi.createAnnouncement(sessionId, body.trim()));
    if (data) {
      onSessionChange(data);
      setBody('');
    }
  }

  return (
    <div>
      <h2 className="font-semibold text-zinc-200 mb-3">Annonces</h2>
      {announcements.length === 0 ? (
        <p className="text-sm text-zinc-500">Aucune annonce.</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {announcements.map((a) => (
            <li key={a.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <p className="text-sm text-zinc-200 whitespace-pre-wrap">{a.body}</p>
              <p className="mt-1 text-[10px] text-zinc-500">
                {a.author_username} — {new Date(a.created_at).toLocaleString('fr-FR')}
              </p>
            </li>
          ))}
        </ul>
      )}
      {isAdmin && session.status === 'open' && (
        <form onSubmit={handlePublish} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            maxLength={500}
            placeholder="Nouvelle annonce (notifie tous les inscrits)…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="submit"
            disabled={busy || !body.trim()}
            className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
          >
            Publier
          </button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wrap-up MSP : ajustements libres + clôture
// ---------------------------------------------------------------------------

function AdminWrapUpSection({
  participants,
  busy,
  onAward,
  onClose,
}: {
  participants: NonNullable<EventSessionDetail['participants']>;
  busy: boolean;
  onAward: (awards: Array<{ participantId: number; amount: number }>) => Promise<void>;
  onClose: () => Promise<void>;
}) {
  const [selectedParticipant, setSelectedParticipant] = useState('');
  const [amount, setAmount] = useState('');

  async function handleAward() {
    const participantId = Number(selectedParticipant);
    const parsed = Number(amount);
    if (!Number.isInteger(participantId) || !Number.isInteger(parsed) || parsed <= 0) return;
    await onAward([{ participantId, amount: parsed }]);
    setAmount('');
    setSelectedParticipant('');
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-zinc-300">Panel MSP — ajustements libres</h3>
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          value={selectedParticipant}
          onChange={(e) => setSelectedParticipant(e.target.value)}
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="">Participant…</option>
          {participants.map((p) => (
            <option key={p.user_id} value={p.user_id}>
              {p.username}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          step={1}
          placeholder="Montant (SP)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full sm:w-36 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          type="button"
          onClick={handleAward}
          disabled={busy || !selectedParticipant || !Number.isInteger(Number(amount)) || Number(amount) <= 0}
          className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
        >
          Attribuer
        </button>
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="w-full bg-red-500/80 hover:bg-red-500 text-zinc-100 font-semibold px-4 py-2 rounded-md transition disabled:opacity-50"
      >
        Clôturer la session
      </button>
      <p className="text-xs text-zinc-500">
        La dotation par rang est distribuée automatiquement dès que le dernier match est joué.
      </p>
    </div>
  );
}
