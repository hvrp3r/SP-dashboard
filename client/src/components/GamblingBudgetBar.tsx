import type { GamblingStatus } from '../types.js';

export default function GamblingBudgetBar({ status }: { status: GamblingStatus }) {
  const { spentToday, maxWagerPerDay, enabled } = status;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-md p-4 mb-6">
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="text-zinc-400">Budget gambling du jour</span>
        <span className="text-zinc-300 font-medium">
          {spentToday} / {maxWagerPerDay} SP
        </span>
      </div>
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full bg-emerald-500 transition-all"
          style={{
            width: `${maxWagerPerDay > 0 ? Math.min(100, (spentToday / maxWagerPerDay) * 100) : 0}%`,
          }}
        />
      </div>
      {!enabled && (
        <p className="text-xs text-red-400 mt-2">Le gambling est désactivé par le MSP.</p>
      )}
    </div>
  );
}
