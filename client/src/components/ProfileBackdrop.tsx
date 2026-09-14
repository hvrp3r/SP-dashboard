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
 *
 * La bannière (une image 800×200 fixe — scène ou motif, pas destinée à être
 * répétée) est affichée à un zoom fixé en pixels (`BANNER_ZOOM_HEIGHT`, un
 * multiple de sa hauteur native de 200px) plutôt que `background-size: cover` :
 * `cover` reste dépendant de la largeur du viewport (bord à bord), donnant un
 * agrandissement qui varie tout seul d'un écran à l'autre — ici il reste le
 * même partout, réglable à un seul endroit. `bg-no-repeat` fait qu'elle
 * s'arrête net une fois `BANNER_ZOOM_HEIGHT` atteint (pas de répétition).
 * Le voile dégradé est calé sur cette même hauteur (pas `h-full` sur toute la
 * page, qui répartirait ses paliers de couleur sur une hauteur variable — sur
 * une page longue, le dégradé n'aurait pas fini de foncer au moment où l'image
 * s'arrête net, laissant voir la coupure) : il atteint le noir plein bien avant
 * cette limite (`via-zinc-950 via-60%`, opaque dès 60% de la hauteur) pour une
 * marge de sécurité, et le reste de la page en dessous retombe simplement sur
 * le `bg-zinc-950` uni du conteneur parent — même couleur, donc aucune coupure
 * visible à la jonction.
 */
const BANNER_ZOOM_HEIGHT = 1000;

export default function ProfileBackdrop({ bannerUrl, children }: ProfileBackdropProps) {
  return (
    <div className="relative isolate min-h-screen bg-zinc-950 py-10 px-4">
      {bannerUrl && (
        <>
          <div
            className="absolute inset-x-0 top-0 h-full -z-20 bg-top bg-no-repeat"
            style={{ backgroundImage: `url(${bannerUrl})`, backgroundSize: `auto ${BANNER_ZOOM_HEIGHT}px` }}
          />
          <div
            className="absolute inset-x-0 top-0 -z-10 bg-gradient-to-b from-zinc-950/20 via-zinc-950 via-60% to-zinc-950"
            style={{ height: BANNER_ZOOM_HEIGHT + 500 }}
          />
        </>
      )}
      {children}
    </div>
  );
}
