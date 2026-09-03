import { resolveAvatarUrl } from '../lib/avatar.js';

interface AvatarProps {
  username: string;
  avatarUrl: string | null;
  size?: number;
  className?: string;
}

export default function Avatar({ username, avatarUrl, size = 40, className = '' }: AvatarProps) {
  const resolved = resolveAvatarUrl(avatarUrl);

  if (resolved) {
    return (
      <img
        src={resolved}
        alt={username}
        style={{ width: size, height: size }}
        className={`rounded-full object-cover flex-shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      className={`rounded-full bg-emerald-500 flex items-center justify-center font-bold text-zinc-950 flex-shrink-0 ${className}`}
    >
      {username[0]?.toUpperCase()}
    </div>
  );
}
