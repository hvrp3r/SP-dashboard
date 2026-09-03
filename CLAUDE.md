# CLAUDE.md — Points Sourires (SP)

## Vue d'ensemble du projet

**Points Sourires** est une plateforme gamifiée de fausse économie entre amis. La monnaie virtuelle s'appelle les **SP (Points Sourires)**. Les joueurs peuvent en gagner via des connexions quotidiennes, des défis entre joueurs (avec mise), et des mini-jeux organisés par le **MSP (Maître des Points Sourires)**.

Le jeu est organisé en **saisons** : chaque saison a ses propres classements et statistiques, permettant de repartir sur de nouvelles bases tout en conservant l'historique.

---

## Stack technique

Les apps sont écrit uniquement en TS, et le repo est un multi repo utilisant pnpm

| Couche | Choix |
|---|---|
| Frontend | React + Vite + TailwindCSS |
| Backend | Node.js + Express (API REST) |
| Base de données | PostgreSQL (self-hosted) |
| Auth | JWT (Access token + Refresh token) |
| ORM | Aucun — `pg` + requêtes SQL brutes, migrations numérotées dans `server/src/db/migrations/` |
| Déploiement | Docker Compose (frontend + backend + postgres) |

### Structure du projet

```
/
├── client/          # React + Vite + Tailwind
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── api/     # Wrappers fetch vers l'API Express
├── server/          # Express API
│   ├── routes/
│   ├── controllers/
│   ├── middleware/
│   ├── services/    # Logique métier (SP, défis, mini-jeux…)
│   └── db/          # Connexion PostgreSQL + migrations
├── docker-compose.yml
└── CLAUDE.md
```

---

## Architecture des données (schéma PostgreSQL)

### `users`
```sql
id SERIAL PRIMARY KEY,
username VARCHAR(50) UNIQUE NOT NULL,
email VARCHAR(255) UNIQUE NOT NULL,
password_hash TEXT NOT NULL,
avatar_url TEXT,
role VARCHAR(20) NOT NULL DEFAULT 'player',  -- 'player' | 'admin'
sp_balance INT NOT NULL DEFAULT 0,
sp_total_earned INT NOT NULL DEFAULT 0,      -- cumulatif all-time
login_streak INT NOT NULL DEFAULT 0,
last_login_date DATE,                         -- date UTC de dernière connexion (pour bonus)
created_at TIMESTAMPTZ DEFAULT NOW(),
is_leaderboard_hidden BOOLEAN NOT NULL DEFAULT FALSE  -- MSP invisible du classement (migration 008)
```

### `seasons`
```sql
id SERIAL PRIMARY KEY,
name VARCHAR(100) NOT NULL,           -- ex: "Saison 1 — Hiver 2025"
starts_at TIMESTAMPTZ NOT NULL,
ends_at TIMESTAMPTZ,                  -- NULL = saison en cours
status VARCHAR(20) DEFAULT 'active',  -- 'active' | 'closed'
created_by INT REFERENCES users(id),
created_at TIMESTAMPTZ DEFAULT NOW()
```

### `season_snapshots`
-- Classement figé à la clôture de chaque saison
```sql
id SERIAL PRIMARY KEY,
season_id INT REFERENCES seasons(id),
user_id INT REFERENCES users(id),
final_balance INT NOT NULL,
final_total_earned INT NOT NULL,
rank INT NOT NULL,
created_at TIMESTAMPTZ DEFAULT NOW()
```

### `sp_transactions`
```sql
id SERIAL PRIMARY KEY,
user_id INT REFERENCES users(id),
season_id INT REFERENCES seasons(id),
amount INT NOT NULL,                   -- positif = crédit, négatif = débit
type VARCHAR(50) NOT NULL,
  -- 'login_bonus' | 'challenge_win' | 'challenge_loss'
  -- 'minigame_reward' | 'admin_grant' | 'admin_deduct'
related_id INT,                        -- challenge_id ou minigame_session_id (nullable)
note TEXT,
created_at TIMESTAMPTZ DEFAULT NOW(),
revoked_at TIMESTAMPTZ,                -- non NULL si le MSP a révoqué cette transaction
revoked_by INT REFERENCES users(id)
```
- Révoquer une transaction ne supprime jamais la ligne d'origine : elle est marquée `revoked_at`/`revoked_by`, et une transaction d'ajustement inverse (`admin_grant`/`admin_deduct`) est créée séparément via `creditSP`/`debitSP`. Impossible de révoquer une transaction dont la `season_id` pointe vers une saison `closed`, ni de révoquer deux fois la même transaction.

### `challenges`
> Un défi peut avoir **plusieurs adversaires au sein du même défi** (pas plusieurs défis séparés) — voir [Système de défis](#4-système-de-défis-sp-wager) plus bas. La liste des participants (challenger inclus) vit dans `challenge_participants`, pas dans cette table.
```sql
id SERIAL PRIMARY KEY,
season_id INT REFERENCES seasons(id),
challenger_id INT REFERENCES users(id),  -- créateur du défi (toujours "accepted" dans challenge_participants)
wager_amount INT NOT NULL,               -- mise par joueur (identique pour tous les participants)
description TEXT,                        -- note libre du créateur
status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- 'pending' | 'accepted' | 'declined' | 'expired' | 'resolved' | 'cancelled'
winner_id INT REFERENCES users(id),   -- NULL jusqu'à résolution
result_note TEXT,                      -- note libre du MSP en cas d'arbitrage
created_at TIMESTAMPTZ DEFAULT NOW(),
expires_at TIMESTAMPTZ NOT NULL,       -- created_at + 24h
resolved_at TIMESTAMPTZ,
cancelled_at TIMESTAMPTZ,              -- non NULL si annulé par le MSP
cancelled_by INT REFERENCES users(id)
```

### `challenge_participants`
-- Un joueur par ligne (challenger inclus). Remplace l'ancien couple `challenged_id` / colonnes de déclaration 1v1.
```sql
id SERIAL PRIMARY KEY,
challenge_id INT REFERENCES challenges(id),
user_id INT REFERENCES users(id),
is_challenger BOOLEAN NOT NULL DEFAULT FALSE,
status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending' | 'accepted' | 'declined'
reported_winner_id INT REFERENCES users(id),    -- déclaration individuelle du gagnant
responded_at TIMESTAMPTZ,
created_at TIMESTAMPTZ DEFAULT NOW(),
UNIQUE (challenge_id, user_id)
```

### `minigame_sessions`
```sql
id SERIAL PRIMARY KEY,
season_id INT REFERENCES seasons(id),
game_type VARCHAR(50) NOT NULL,       -- 'quiz' (seul type pour l'instant)
title VARCHAR(255),                   -- ex: "Quiz Culture Générale #3"
description TEXT,
status VARCHAR(20) DEFAULT 'open',    -- 'open' | 'closed'
created_by INT REFERENCES users(id), -- doit être admin (MSP)
created_at TIMESTAMPTZ DEFAULT NOW(),
closed_at TIMESTAMPTZ
```

### `minigame_participants`
-- Un joueur rejoint lui-même une session ouverte (pas d'ajout manuel par défaut, même si le MSP peut aussi ajouter/retirer un participant depuis le panel).
```sql
id SERIAL PRIMARY KEY,
session_id INT REFERENCES minigame_sessions(id),
user_id INT REFERENCES users(id),
sp_awarded INT DEFAULT 0,             -- montant libre choisi par le MSP (pas lié à un rang)
awarded_by INT REFERENCES users(id), -- MSP qui a validé
awarded_at TIMESTAMPTZ,
joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

### `minigame_questions`
-- Une question "en direct" à la fois par session ; en poser une nouvelle clôture automatiquement la précédente.
```sql
id SERIAL PRIMARY KEY,
session_id INT REFERENCES minigame_sessions(id),
prompt TEXT NOT NULL,
status VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active' | 'closed'
created_at TIMESTAMPTZ DEFAULT NOW(),
activated_at TIMESTAMPTZ,
closed_at TIMESTAMPTZ
```

### `minigame_answers`
-- Réponse libre, verrouillée une fois soumise (pas de modification). Le texte n'est visible que par le MSP et par l'auteur de la réponse ; les autres joueurs ne voient que le statut "a répondu" + le temps de réponse.
```sql
id SERIAL PRIMARY KEY,
question_id INT REFERENCES minigame_questions(id),
user_id INT REFERENCES users(id),
answer_text TEXT NOT NULL,
submitted_at TIMESTAMPTZ DEFAULT NOW(),
UNIQUE (question_id, user_id)
```

### `notifications`
```sql
id SERIAL PRIMARY KEY,
user_id INT REFERENCES users(id),
type VARCHAR(50) NOT NULL,
  -- 'challenge_received' | 'challenge_accepted' | 'challenge_declined' | 'challenge_resolved'
  -- 'challenge_cancelled' | 'challenge_expired' | 'minigame_open' | 'sp_gained' | 'sp_lost'
message TEXT NOT NULL,
link TEXT,                             -- route client pour le clic (ex: '/defis')
read_at TIMESTAMPTZ,
created_at TIMESTAMPTZ DEFAULT NOW()
```

### `admin_config`
```sql
key VARCHAR(100) PRIMARY KEY,
value TEXT NOT NULL,
description TEXT,
updated_by INT REFERENCES users(id),
updated_at TIMESTAMPTZ DEFAULT NOW()
-- Clés attendues :
--   max_wager_amount          (défaut: 100)
--   max_challenges_per_day    (défaut: 5)
--   login_bonus_base          (défaut: 10)
--   streak_bonus_step         (SP bonus par palier de streak, défaut: 2)
--   streak_bonus_max          (plafond du bonus streak, défaut: 20)
--   streak_required_days      (nb jours consécutifs par palier, défaut: 7)
-- Note : minigame_reward_1st/2nd/3rd ont existé puis ont été supprimées (migration 005) —
-- l'attribution des SP en mini-jeu est un montant libre par joueur, plus des récompenses fixes par rang.
```

---

## Saisons — logique

- Une seule saison peut être `active` à la fois
- À la clôture d'une saison, un `season_snapshot` est créé pour chaque joueur (classement figé)
- Le classement principal affiche toujours la **saison active**
- Une page "Archives" permet de consulter les classements des saisons passées
- Les `sp_transactions` sont toujours liées à une `season_id` pour permettre le filtrage par saison

---

## Fonctionnalités — spécifications détaillées

### 1. Auth & Comptes

- Inscription : username + email + mot de passe (hashé avec bcrypt)
- Connexion : JWT access token (15min) + refresh token (7j, stocké en httpOnly cookie)
- Profil public : avatar, username, solde SP, stats de la saison active
- Profil privé (connecté) : historique des transactions, défis, mini-jeux

### 2. Leaderboard

- **Saison active** uniquement par défaut
- Tri sélectionnable par l'utilisateur :
  - `sp_balance` — Solde actuel (**défaut**)
  - `sp_total_earned` — Total gagné (all-time sur la saison)
- Colonnes : rang, avatar, username, solde SP, total gagné
- Rafraîchissement toutes les **60 secondes** (polling)
- Page "Archives" : sélectionner une saison passée → affiche le `season_snapshot`
- **Visibilité MSP** : un admin peut se rendre invisible du classement (`is_leaderboard_hidden`). Il n'apparaît plus dans le leaderboard, les `season_snapshot`, ni dans le calcul de rang des autres joueurs (un MSP caché avec un gros solde n'occupe pas un rang). Son propre rang devient alors `null` ("Hors classement"). Profil et transactions restent consultables normalement.

### 3. Bonus de connexion quotidienne + Streak

- Déclenché à la **première requête authentifiée de la journée** (comparaison date UTC)
- Montant de base : `login_bonus_base` SP (configurable par le MSP)
- **Système de streak** :
  - Si l'utilisateur s'est connecté la veille, le streak augmente de 1
  - Si non, le streak repart à 1
  - Bonus supplémentaire : `floor(streak / streak_required_days) × streak_bonus_step` SP, plafonné à `streak_bonus_max`
  - Exemple avec défauts (step=2, required=7, max=20) : streak 1–6 → +0 SP, 7–13 → +2 SP, 14–20 → +4 SP, 70+ → +20 SP (plafond)
- Chaque bonus génère une entrée dans `sp_transactions` (type `login_bonus`, note indique le streak)
- Le streak et les paramètres sont modifiables par le MSP (admin_config + reset manuel possible)

> **Pièges d'implémentation rencontrés** (à garder en tête pour toute modif de cette logique) :
> - **Race condition** : plusieurs requêtes authentifiées en parallèle peuvent toutes lire `last_login_date` avant qu'aucune ne l'ait réécrit → double/triple crédit. Toute la séquence check-then-act doit être dans une seule transaction avec `SELECT ... FOR UPDATE` sur la ligne user ; `creditSP`/`debitSP` acceptent un `client` (PoolClient) optionnel pour rejoindre cette transaction plutôt que d'en ouvrir une nouvelle (sinon deadlock).
> - **Parsing de `DATE` par `pg`** : node-postgres convertit par défaut une colonne `DATE` en objet `Date` construit avec les composantes *locales*, ce qui décale silencieusement la date d'un jour dans les fuseaux UTC+ (France) une fois reconverti en UTC — casse totalement la comparaison "connecté hier ?". Le parser du type `DATE` est neutralisé globalement dans `server/src/db/pool.ts` (`types.setTypeParser(types.builtins.DATE, v => v)`), pour garder les dates comme simples chaînes `'YYYY-MM-DD'`.

### 4. Système de défis (SP Wager)

Un défi peut réunir **plusieurs adversaires au sein d'un même défi** (un seul pot commun, un seul gagnant), pas plusieurs défis 1v1 séparés. Le cas 1 challenger + 1 adversaire est simplement le cas N=2 de ce modèle général — l'économie SP est identique à l'ancien système 1v1.

#### Flux :
1. Joueur A crée un défi vers un ou plusieurs adversaires, avec une mise (identique pour tout le monde) et une description libre optionnelle. Un défi = une ligne `challenges` + une ligne `challenge_participants` par personne (challenger inclus, automatiquement `accepted` — il n'a pas besoin d'accepter son propre défi).
2. Chaque adversaire invité a **24h** pour accepter ou décliner *individuellement*. Le défi global reste `pending` tant qu'il reste au moins un participant `pending`.
3. Une fois que tout le monde a répondu (ou que le délai de 24h expire, ce qui force les non-répondants restants en `declined`) :
   - S'il reste **≥ 2 participants `accepted`** (challenger inclus) → le défi passe `accepted`, la partie a lieu hors-plateforme entre les seuls participants ayant accepté.
   - Sinon (personne n'a accepté) → le défi passe `declined` (que ce soit par refus explicite ou par expiration — la distinction n'a plus grand sens à N joueurs).
4. N'importe quel participant `accepted` peut déclarer qui a gagné (`reported_winner_id`, modifiable tant que non résolu). Dès que **tous** les participants `accepted` ont déclaré le **même** gagnant, la résolution est automatique.
5. En cas de désaccord (déclarations différentes une fois que tout le monde a déclaré) → le MSP arbitre (panel admin → force un gagnant parmi les participants `accepted`).
6. À la résolution : le gagnant reçoit `wager × nombre de participants accepted` SP (le pot entier), chacun des autres participants `accepted` perd `wager` SP. Une transaction SP par participant est générée (`challenge_win` pour le gagnant, `challenge_loss` pour chacun des autres), toutes dans la même transaction DB.
7. Le MSP peut supprimer/invalider un défi à tout moment (`pending`, `accepted` ou `resolved`) : une confirmation explique que les transactions SP seront révoquées si le défi était déjà résolu (gain du vainqueur + pertes de chacun des autres participants), avec ajustement des soldes en conséquence.

#### Validation (avant création) :
- `challenger.sp_balance >= wager_amount` (le challenger ne risque que sa propre mise, quel que soit le nombre d'adversaires)
- **Tous les adversaires invités ont déjà `sp_balance >= wager_amount` au moment de la création** — bloque la création avec le nom des adversaires concernés plutôt que de laisser un défi injouable se créer
- `wager_amount <= max_wager_amount`
- Nombre de défis créés aujourd'hui par ce joueur < `max_challenges_per_day` (**un défi à N adversaires compte pour 1**, pas pour N)
- Pas de défi contre soi-même, pas d'adversaire dupliqué
- **À l'acceptation** : le joueur qui accepte doit toujours avoir `sp_balance >= wager_amount` à cet instant (son solde a pu changer depuis l'invitation) — sinon l'acceptation est refusée
- Vérifier à la résolution que chaque perdant a un solde suffisant (si changé entre-temps sur l'un d'eux → toute la résolution échoue et rien n'est modifié, le MSP gère ensuite via arbitrage)

#### Contraintes MSP (via admin_config) :
- `max_wager_amount` : mise max par défi (par joueur)
- `max_challenges_per_day` : nombre max de défis *lancés* par joueur par jour (peu importe le nombre d'adversaires invités dans chacun)

### 5. Mini-Jeux — Quiz en direct (seul type actuel)

> Ce système a été repensé en cours de projet : la version initiale (MSP saisit des résultats obtenus hors-plateforme, récompenses fixes par rang 🥇🥈🥉) a été remplacée par un **quiz interactif en direct**, à la demande explicite de l'utilisateur. Les clés `minigame_reward_1st/2nd/3rd` n'existent plus.

#### Création & participation :
- Le MSP crée une session depuis la page Mini-jeux (les fonctionnalités MSP y sont visibles uniquement pour les admins — pas de page `/admin` séparée) : type de jeu, titre, description
- La session passe en `open` → visible par tous les joueurs
- **N'importe quel joueur peut rejoindre lui-même** la session (`minigame_participants`, self-join) — le MSP peut aussi ajouter/retirer un participant manuellement depuis le panel

#### Déroulement en direct :
- Le MSP affiche une question à la fois (`minigame_questions`, statut `active`) ; en poser une nouvelle clôture automatiquement la précédente
- Les joueurs voient la question en temps réel (polling) et soumettent une réponse libre — **verrouillée une fois soumise**, pas de modification possible
- Le temps de réponse (`seconds_to_answer`) est calculé côté serveur
- **Confidentialité des réponses** : le texte d'une réponse n'est visible que par le MSP et par son auteur ; les autres joueurs voient seulement que la personne "a répondu" + son temps, jamais le contenu (sérialisation role-aware côté contrôleur)
- Le MSP peut clôturer la question en cours à tout moment

#### Attribution des récompenses (MSP) :
- Une fois la question (ou la session) close, le MSP attribue un **montant SP libre** à chaque participant, joueur par joueur — **pas de montant fixe par rang**, pas de lien automatique avec la rapidité de réponse
- Chaque attribution génère une transaction `minigame_reward`
- Le MSP clôture la session (`closed`) une fois les SP attribués
- Un historique des questions posées reste consultable dans la session (`GET /:id/questions`)

#### Évolutivité :
- La colonne `game_type` dans `minigame_sessions` est prévue pour accueillir de futurs types de jeux
- La logique d'attribution manuelle et libre par le MSP s'appliquera à tous les types futurs

### 6. Notifications & synchronisation temps réel

- Pas de WebSocket (décision assumée) : tout est en **polling**, à des intervalles courts par écran :
  - Cloche de notifications : compte + liste ensemble toutes les 10s
  - Défis (joueur et admin) : toutes les 5s
  - Session mini-jeu ouverte (question en cours) : toutes les 2s
  - Solde/streak utilisateur (`useAuth`) : toutes les 15s
  - Transactions récentes du profil : toutes les 10s
- Une notification (`notifications`, type + message + `link` de redirection) est créée pour : défi reçu/accepté/décliné/résolu/annulé/expiré, mini-jeu ouvert, gain de SP, perte de SP
- Toujours déclenchée depuis les **contrôleurs**, jamais depuis les services (les services ne connaissent pas la couche notification)

---

## Rôles & Permissions

| Action                               | `player` | `admin` (MSP) |
|--------------------------------------|---|---|
| Se connecter, voir le leaderboard    | ✅ | ✅ |
| Créer/accepter des défis             | ✅ | ✅ |
| Participer aux mini-jeux             | ✅ | ✅ |
| Voir ses transactions                | ✅ | ✅ |
| Créer/clôturer une session mini-jeu  | ❌ | ✅ |
| Attribuer les SP d'un mini-jeu       | ❌ | ✅ |
| Arbitrer un défi                     | ❌ | ✅ |
| Gérer les saisons                    | ❌ | ✅ |
| Modifier admin_config                | ❌ | ✅ |
| Accorder/retirer des SP manuellement | ❌ | ✅ |
| Révoquer une transaction SP          | ❌ | ✅ |
| Annuler/invalider un défi            | ❌ | ✅ |
| Se rendre invisible du leaderboard   | ❌ | ✅ |
| Promouvoir un joueur admin           | ❌ | ✅ |
| Voir tous les logs de transactions   | ❌ | ✅ |

> Il n'y a **pas de limite** au nombre d'admins. N'importe quel admin peut en promouvoir un autre.

---

## Panel Admin (MSP)

> Deux approches coexistent, par choix explicite : certaines sections MSP ont leur propre route `/admin/...` protégée par `requireAdmin` ; d'autres sont **fusionnées dans les pages joueur partagées**, avec les contrôles MSP affichés uniquement si `user.role === 'admin'`. Les Mini-Jeux ont été délibérément migrés de "page admin séparée" vers "section MSP dans la page joueur" en cours de projet, à la demande explicite de l'utilisateur — ne pas recréer de page `/admin/mini-jeux` séparée.

Sections dans des pages `/admin/...` dédiées :
- **Config** : formulaire pour modifier toutes les clés `admin_config`
- **Saisons** : créer, clôturer, consulter les archives
- **Joueurs** : liste, modifier le solde SP, promouvoir/rétrograder, reset streak, se rendre invisible du leaderboard
- **Défis** (`/admin/defis`) : liste filtrée (en cours, en attente, contestés), arbitrage (force un gagnant parmi les participants `accepted`), annulation
- **Transactions** : log global avec filtres (joueur, type, saison, date), révocation, création manuelle de transaction

Sections fusionnées dans la page joueur correspondante (visibles seulement si MSP) :
- **Mini-Jeux** (`/mini-jeux`, `/mini-jeux/:id`) : créer une session, poser/clôturer une question, attribuer les SP librement, clôturer la session

---

## Ordre de build recommandé

> Phases 1 à 6 sont **complétées**. Le contenu ci-dessous reste comme trace de la spec initiale ; certains points ont évolué en cours de route (voir notes ⚠️) — se fier aux sections détaillées plus haut, pas à ce plan, en cas de divergence.

```
Phase 1 — Fondations ✅
  ✅ Setup monorepo (client/ + server/) + Docker Compose + PostgreSQL
  ✅ Schéma SQL + migrations
  ✅ Auth : inscription, connexion, JWT + refresh token
  ✅ Middleware auth + role guard (requireAuth, requireAdmin)
  ✅ Profil utilisateur + solde SP

Phase 2 — Saisons & Leaderboard ✅
  ✅ CRUD saisons (MSP)
  ✅ Leaderboard avec tri sélectionnable (solde / total gagné)
  ✅ Page archives saisons passées (season_snapshots)

Phase 3 — Engagement quotidien ✅
  ✅ Bonus de connexion quotidienne
  ✅ Système de streak (avec config MSP)
  ✅ Log des transactions SP

Phase 4 — Défis ✅
  ✅ Création de défi + invitation
  ✅ Accept / Decline / Expire (check à la lecture, pas de cron)
  ✅ Soumission résultat + confirmation par consensus
  ✅ Résolution + transfert SP
  ✅ Arbitrage MSP
  ⚠️ Étendu en cours de projet : plusieurs adversaires au sein d'un même défi (voir section 4), description libre, annulation/invalidation MSP

Phase 5 — Mini-Jeux (Quiz) ✅
  ⚠️ Pivot complet en cours de projet : quiz en direct (self-join, question live, réponses cachées, SP libres) — remplace la version initiale "MSP saisit un rang, récompenses fixes" (voir section 5)

Phase 6 — Polish ✅
  ✅ Notifications in-app (défi reçu/accepté/décliné/résolu/annulé/expiré, mini-jeu ouvert, gain/perte de SP) + synchronisation temps réel par polling
  ✅ Upload avatar
  ✅ Page stats détaillée par joueur
  ✅ Responsive mobile + nav fixe en haut + micro-animations ("juice")
```

### Fonctionnalités additionnelles (hors spec initiale)

Ajoutées en cours de projet, à la demande de l'utilisateur, non prévues dans le plan ci-dessus :
- Révocation d'une transaction SP par le MSP (jamais de suppression, ajustement inverse tracé)
- Visibilité du MSP dans le leaderboard (`is_leaderboard_hidden`)
- Transactions classées par saison dans la page transactions ; interdiction de révoquer une transaction d'une saison archivée
- Le MSP peut créer une transaction SP manuelle directement (pas seulement ajuster un solde)
- Popups de confirmation custom (`useConfirm`) à la place de `window.confirm` natif
- Tags visuels du type de mini-jeu dans la liste des mini-jeux

---

## Conventions de code

- **Langue** : code et commentaires en anglais, UI en français
- **SP** toujours en entier (INT), jamais de décimales
- Toutes les mutations de solde SP passent par une fonction centrale :
  ```ts
  // server/src/services/sp.service.ts
  await creditSP({ userId, amount, type, seasonId, relatedId, note, client })
  await debitSP({ userId, amount, type, seasonId, relatedId, note, client })
  // Ces fonctions vérifient le solde, effectuent la mutation, et insèrent la transaction
  // Jamais de UPDATE sp_balance direct en dehors de ce service
  // `client` (PoolClient) est optionnel : à passer pour composer l'appel dans une transaction
  // déjà ouverte par l'appelant (ex : résolution de défi à N participants, bonus de connexion
  // avec verrou de ligne) — sinon la fonction ouvre et commit sa propre transaction.
  ```
- Interdiction formelle d'avoir `sp_balance < 0` — vérification en amont ET contrainte CHECK en BDD :
  ```sql
  ALTER TABLE users ADD CONSTRAINT sp_balance_non_negative CHECK (sp_balance >= 0);
  ```
- Les valeurs `admin_config` sont relues depuis la BDD à chaque requête sensible (pas de cache)
- Tous les timestamps en **UTC**
- Les dates de connexion comparées en UTC date (pas datetime) pour le bonus quotidien
- ⚠️ Le SQL brut (pas d'ORM) n'est pas vérifié par `tsc` : après tout changement de schéma (colonne renommée/supprimée), grep le nom de colonne dans `server/src/` pour rattraper les requêtes qui le référencent encore ailleurs que dans le service concerné — `tsc --noEmit` propre ne garantit rien ici.

---

## Variables d'environnement

```env
# server/.env
DATABASE_URL=postgresql://user:password@localhost:5432/points_sourires
JWT_SECRET=
JWT_REFRESH_SECRET=
PORT=3001
NODE_ENV=development

# client/.env
VITE_API_URL=http://localhost:3001
```

---

## Questions résolues

| Question | Décision                                                                |
|---|-------------------------------------------------------------------------|
| Classement trié par ? | Solde actuel par défaut, choix utilisateur                              |
| Système de streak ? | Oui — progressif, configurable par le MSP                               |
| Résolution de défi | Manuelle (consensus de tous les participants `accepted`) + arbitrage MSP |
| Solde négatif possible ? | **Non** — bloqué applicativement + contrainte BDD                       |
| Nombre max d'admins | **Aucune limite**                                                       |
| Qui crée les mini-jeux ? | **MSP uniquement**                                                      |
| Récompenses mini-jeu | ~~Montants fixes~~ → **montant libre choisi par le MSP par joueur** (pivot vers le quiz en direct) |
| Saisons | Oui — classements et stats par saison, archives consultables            |
| Un défi peut-il avoir plusieurs adversaires ? | Oui — **au sein d'un même défi** (un pot commun, un gagnant), pas plusieurs défis séparés. Correction explicite de l'utilisateur après une première implémentation erronée en "N défis 1v1 indépendants". |
| Mise en cas de N adversaires ? | Chacun mise le même montant ; le gagnant remporte le pot entier (`wager × participants accepted`) — généralisation stricte du 1v1 |
| Tout le monde doit-il accepter avant que le défi démarre ? | Non — dès que les réponses sont toutes connues (ou le délai de 24h expiré), le défi démarre s'il reste ≥ 2 acceptants ; les refus individuels n'annulent pas les autres |
| Synchronisation temps réel ? | Polling à intervalles courts par écran (pas de WebSocket) — voir section 6 |
| Le MSP peut-il être caché du classement ? | Oui — `is_leaderboard_hidden`, n'affecte que les classements, pas le profil/les transactions |
| Le MSP peut-il révoquer une transaction ? | Oui, sauf si sa saison est archivée (`closed`) — jamais de suppression, toujours un ajustement inverse tracé |
| Architecture des pages admin ? | Mixte : pages `/admin/...` dédiées pour Config/Saisons/Joueurs/Défis/Transactions, mais Mini-Jeux est fusionné dans la page joueur (contrôles visibles si MSP) — décision explicite de l'utilisateur, ne pas re-séparer |