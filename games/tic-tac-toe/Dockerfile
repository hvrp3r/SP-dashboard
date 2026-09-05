# node:*-alpine (musl) n'est PAS utilisé ici contrairement à server/Dockerfile et
# client/Dockerfile : @nanoforge-dev/network-server dépend de `wrtc`, dont le
# binaire natif prébuilt cible glibc — testé et confirmé fonctionnel sur bookworm,
# pas revalidé sur alpine. @nanoforge-dev/cli (`nf`) lui-même a un bug de résolution
# de chemin sur Windows natif (chemin `C:\C:\...` doublé) : ce Dockerfile est donc
# la SEULE façon supportée de builder/lancer ce jeu, jamais `nf` directement sur
# l'hôte Windows d'un contributeur.
#
# `nf start` (pas `nf dev`) : `nf dev` ouvre en plus un port de watcher choisi au
# hasard à chaque lancement (visible dans les logs, ex: "Watcher started on url
# http://localhost:33775/"), impossible à publier de façon fixe via Docker Compose.
# Conséquence assumée : un changement de code dans ce package exige un restart du
# conteneur (`docker compose restart tic-tac-toe`), pas de hot-reload — déjà mieux
# que games/flappy-bird, qui n'a aujourd'hui aucun service Docker du tout.
FROM node:22-bookworm

WORKDIR /app

RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY games/tic-tac-toe/package.json ./games/tic-tac-toe/package.json
RUN pnpm install --frozen-lockfile --filter tic-tac-toe

COPY games/tic-tac-toe ./games/tic-tac-toe
COPY tsconfig.base.json ./tsconfig.base.json

WORKDIR /app/games/tic-tac-toe

RUN pnpm run build

EXPOSE 5175 4446

CMD ["pnpm", "run", "start"]
