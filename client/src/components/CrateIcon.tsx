interface CrateIconProps {
  imageUrl: string | null;
  size?: number;
  className?: string;
}

export default function CrateIcon({ imageUrl, size = 48, className = '' }: CrateIconProps) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        style={{ width: size, height: size }}
        className={`rounded-lg object-cover flex-shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      className={`rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0 ${className}`}
    >
      📦
    </div>
  );
}
