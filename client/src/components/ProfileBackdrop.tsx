import type { ReactNode } from 'react';

interface ProfileBackdropProps {
  bannerUrl: string | null;
  children: ReactNode;
}

/**
 * Fond de page plein cadre pour un profil (bannière cosmétique équipée),
 * façon Steam — remplace le fond uni quand un fond est équipé, avec un
 * voile dégradé pour garder le contenu lisible. Sans bannière, comportement
 * neutre inchangé (juste bg-zinc-950).
 */
export default function ProfileBackdrop({ bannerUrl, children }: ProfileBackdropProps) {
  return (
    <div className="relative isolate min-h-screen bg-zinc-950 py-10 px-4">
      {bannerUrl && (
        <>
          <div
            className="absolute inset-0 -z-20 bg-cover bg-center"
            style={{ backgroundImage: `url(${bannerUrl})` }}
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-zinc-950/30 via-zinc-950/80 to-zinc-950" />
        </>
      )}
      {children}
    </div>
  );
}
