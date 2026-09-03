import { resolveAvatarUrl } from '../lib/avatar.js';

interface AvatarProps {
  username: string;
  avatarUrl: string | null;
  size?: number;
  className?: string;
  /** Affiche une petite couronne au-dessus de la photo (réservé au rang #1). */
  crown?: boolean;
}

export default function Avatar({
  username,
  avatarUrl,
  size = 40,
  className = '',
  crown = false,
}: AvatarProps) {
  const resolved = resolveAvatarUrl(avatarUrl);

  const inner = resolved ? (
    <img
      src={resolved}
      alt={username}
      style={{ width: size, height: size }}
      className={`rounded-full object-cover flex-shrink-0 ${className}`}
    />
  ) : (
    <div
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      className={`rounded-full bg-emerald-500 flex items-center justify-center font-bold text-zinc-950 flex-shrink-0 ${className}`}
    >
      {username[0]?.toUpperCase()}
    </div>
  );

  if (!crown) return inner;

  return (
    <span className="relative inline-block flex-shrink-0" style={{ width: size, height: size }}>
      {inner}
      <span
        aria-hidden="true"
        className="absolute left-1/2 -translate-x-1/2 select-none pointer-events-none drop-shadow"
        style={{ top: -Math.round(size * 0.38), fontSize: Math.round(size * 0.5) }}
      >
        👑
      </span>
    </span>
  );
}
