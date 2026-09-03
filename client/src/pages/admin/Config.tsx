import { useEffect, useState } from 'react';
import * as configApi from '../../api/config.js';
import { CONFIG_SECTIONS } from '../../lib/configSections.js';
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

  async function handleToggle(key: string, current: string) {
    setError(null);
    setSavingKey(key);
    try {
      const nextValue = current === 'true' ? 'false' : 'true';
      const updated = await configApi.updateConfig(key, nextValue);
      setConfig((prev) => prev.map((c) => (c.key === key ? updated : c)));
      setDrafts((prev) => ({ ...prev, [key]: updated.value }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setSavingKey(null);
    }
  }

  function renderEntry(entry: AdminConfigEntry) {
    const isBoolean = entry.value === 'true' || entry.value === 'false';
    const dirty = drafts[entry.key] !== entry.value;
    return (
      <div key={entry.key} className="flex items-center gap-4 p-4">
        <div className="flex-1">
          <p className="text-sm font-medium text-zinc-100">{entry.key}</p>
          {entry.description && <p className="text-xs text-zinc-500">{entry.description}</p>}
        </div>
        {isBoolean ? (
          <button
            type="button"
            role="switch"
            aria-checked={entry.value === 'true'}
            onClick={() => handleToggle(entry.key, entry.value)}
            disabled={savingKey === entry.key}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
              entry.value === 'true' ? 'bg-emerald-500' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                entry.value === 'true' ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        ) : (
          <>
            <input
              type="text"
              inputMode="numeric"
              value={drafts[entry.key] ?? ''}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [entry.key]: e.target.value }))}
              className="w-24 rounded-md border border-zinc-700 bg-zinc-950 text-zinc-100 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              onClick={() => handleSave(entry.key)}
              disabled={!dirty || savingKey === entry.key}
              className="text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-3 py-1.5 rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savingKey === entry.key ? '…' : 'Enregistrer'}
            </button>
          </>
        )}
      </div>
    );
  }

  const entryByKey = new Map(config.map((entry) => [entry.key, entry]));
  const sectionedKeys = new Set(CONFIG_SECTIONS.flatMap((section) => section.keys));
  const otherEntries = config.filter((entry) => !sectionedKeys.has(entry.key));
  const sections = [
    ...CONFIG_SECTIONS.map((section) => ({
      title: section.title,
      entries: section.keys.map((key) => entryByKey.get(key)).filter((e): e is AdminConfigEntry => !!e),
    })),
    ...(otherEntries.length > 0 ? [{ title: 'Autres', entries: otherEntries }] : []),
  ].filter((section) => section.entries.length > 0);

  return (
    <div className="min-h-screen bg-zinc-950 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-zinc-50 mb-6">Configuration</h1>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : (
          <div className="space-y-6">
            {sections.map((section) => (
              <div key={section.title}>
                <h2 className="text-sm font-semibold text-zinc-300 uppercase mb-2">
                  {section.title}
                </h2>
                <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md divide-y divide-zinc-800">
                  {section.entries.map(renderEntry)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
