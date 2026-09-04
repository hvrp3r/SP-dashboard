import { RESET_INTERVAL_PRESETS, resetIntervalLabel } from '../lib/gamblingLabels.js';

interface ResetIntervalFieldProps {
  /** '' = pas de reset (limite à vie), sinon le nombre de jours en string. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Choix de l'intervalle de réinitialisation d'une limite d'ouvertures par
 * joueur : presets courants (quotidien / 3 jours / hebdo) + intervalle
 * personnalisé en jours. Le parent doit garder ce champ vide/désactivé tant
 * qu'aucune limite d'ouvertures n'est définie — voir gambling_crates_reset_requires_limit.
 */
export default function ResetIntervalField({ value, onChange, disabled }: ResetIntervalFieldProps) {
  const presetValues = RESET_INTERVAL_PRESETS.map(String);
  const isCustom = value !== '' && !presetValues.includes(value);
  const selectValue = value === '' ? '' : isCustom ? 'custom' : value;

  return (
    <div className="space-y-2">
      <select
        value={selectValue}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === 'custom' ? '5' : v);
        }}
        className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
      >
        <option value="">Limite à vie (jamais réinitialisée)</option>
        {RESET_INTERVAL_PRESETS.map((days) => (
          <option key={days} value={days}>
            {resetIntervalLabel(days)}
          </option>
        ))}
        <option value="custom">Intervalle personnalisé…</option>
      </select>
      {isCustom && (
        <input
          type="number"
          min={1}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Nombre de jours"
          className="w-full rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
        />
      )}
    </div>
  );
}
