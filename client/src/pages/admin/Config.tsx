import { useEffect, useState } from 'react';
import * as configApi from '../../api/config.js';
import type { AdminConfigEntry } from '../../types.js';

export default function AdminConfig() {
  const [config, setConfig] = useState<AdminConfigEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  async function loadConfig() {
    setLoading(true);
    try {
      const data = await configApi.listConfig();
      setConfig(data);
      setDrafts(Object.fromEntries(data.map((c) => [c.key, c.value])));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfig();
  }, []);

  async function handleSave(key: string) {
    setError(null);
    setSavingKey(key);
    try {
      const updated = await configApi.updateConfig(key, drafts[key] ?? '');
      setConfig((prev) => prev.map((c) => (c.key === key ? updated : c)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-6">Configuration</h1>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md divide-y divide-zinc-800">
            {config.map((entry) => {
              const dirty = drafts[entry.key] !== entry.value;
              return (
                <div key={entry.key} className="flex items-center gap-4 p-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-zinc-100">{entry.key}</p>
                    {entry.description && (
                      <p className="text-xs text-zinc-500">{entry.description}</p>
                    )}
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={drafts[entry.key] ?? ''}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [entry.key]: e.target.value }))
                    }
                    className="w-24 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    onClick={() => handleSave(entry.key)}
                    disabled={!dirty || savingKey === entry.key}
                    className="text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {savingKey === entry.key ? '…' : 'Enregistrer'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
