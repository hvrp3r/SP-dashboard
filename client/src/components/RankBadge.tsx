interface RankBadgeProps {
  rank: number | null;
  size?: 'sm' | 'md';
}

const MEDAL_STYLES: Record<number, string> = {
  1: 'bg-gradient-to-b from-yellow-300 to-yellow-500 text-yellow-950 shadow-sm shadow-yellow-500/40',
  2: 'bg-gradient-to-b from-slate-300 to-slate-400 text-slate-900 shadow-sm shadow-slate-400/30',
  3: 'bg-gradient-to-b from-amber-600 to-amber-800 text-amber-50 shadow-sm shadow-amber-700/30',
};

export default function RankBadge({ rank, size = 'md' }: RankBadgeProps) {
  const sizeClasses = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1';

  if (rank === null) {
    return (
      <span
        className={`inline-flex items-center rounded-full bg-zinc-800 text-zinc-500 font-medium ${sizeClasses}`}
      >
        Hors classement
      </span>
    );
  }

  const medalClass = MEDAL_STYLES[rank];
  if (!medalClass) {
    return <span className="font-semibold text-zinc-400">#{rank}</span>;
  }

  return (
    <span className={`inline-flex items-center rounded-full font-bold ${medalClass} ${sizeClasses}`}>
      #{rank}
    </span>
  );
}
