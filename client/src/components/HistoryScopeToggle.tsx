export type HistoryScope = 'all' | 'mine';

interface HistoryScopeToggleProps {
  scope: HistoryScope;
  onChange: (scope: HistoryScope) => void;
}

/** Bascule "Tous les joueurs" / "Moi uniquement" — réutilisée par les historiques des jeux de casino (caisses, blackjack, crash, tower). */
export default function HistoryScopeToggle({ scope, onChange }: HistoryScopeToggleProps) {
  return (
    <div className="flex items-center gap-0.5 bg-zinc-950 border border-zinc-800 rounded-full p-0.5">
      <button
        type="button"
        onClick={() => onChange('all')}
        className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
          scope === 'all' ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        Tous
      </button>
      <button
        type="button"
        onClick={() => onChange('mine')}
        className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
          scope === 'mine' ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-500 hover:text-zinc-300'
        }`}
      >
        Moi
      </button>
    </div>
  );
}
