# CLAUDE.md — Points Sourires (SP)

## Vue d'ensemble du projet

**Points Sourires** est une plateforme gamifiée de fausse économie entre amis. La monnaie virtuelle s'appelle les **SP (Points Sourires)**. Les joueurs peuvent en gagner via des connexions quotidiennes, des défis entre joueurs (avec mise), des mini-jeux organisés par le **MSP (Maître des Points Sourires)**, et les dépenser dans une section **Gambling** (case opening, Blackjack, Crash, Tower) ou sur le marché d'**enchères de cosmétiques** entre joueurs.

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
│   │   ├── pages/       # dont pages/admin/ pour les pages MSP dédiées
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/     # labels/formatage partagés (raretés cosmétiques, libellés gambling…)
│   │   └── api/     # Wrappers fetch vers l'API Express
├── server/          # Express API
│   ├── routes/
│   ├── controllers/
│   ├── middleware/
│   ├── services/    # Logique métier (SP, défis, mini-jeux, jeux gambling, cosmétiques…)
│   ├── utils/       # localDate.ts, jwt.ts…
│   └── db/          # Connexion PostgreSQL + migrations
├── docker-compose.yml
└── CLAUDE.md
```

> ⚠️ Le SQL brut (pas d'ORM) n'est pas vérifié par `tsc` : après tout changement de schéma (colonne renommée/supprimée), grep le nom de colonne dans `server/src/` pour rattraper les requêtes qui le référencent encore ailleurs que dans le service concerné — `tsc --noEmit` propre ne garantit rien ici. Le nombre de migrations grossit vite (44 à ce jour) ; en cas de doute sur l'état actuel d'une colonne/contrainte, se fier au dernier fichier qui la touche, pas à ce document.

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
is_leaderboard_hidden BOOLEAN NOT NULL DEFAULT FALSE,  -- MSP invisible du classement (migration 008)
disabled_at TIMESTAMPTZ,                              -- non NULL si le MSP a désactivé ce compte (migration 021)
disabled_by INT REFERENCES users(id)
```
- Le MSP ne supprime jamais un compte joueur : il le **désactive** (`disabled_at`/`disabled_by`), sur le même principe que `is_leaderboard_hidden` — même raison que pour les transactions/caisses, préserver l'historique (transactions, défis, season_snapshots continuent d'afficher son pseudo). Un compte désactivé ne peut plus se connecter (`login` et `refresh` le rejettent) et disparaît du leaderboard, des archives de saison, et de la sélection d'adversaire de défi (tous filtrés via le même endpoint leaderboard). Réversible par le MSP à tout moment. Un MSP ne peut pas désactiver son propre compte.

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
  -- 'minigame_reward' | 'minigame_entry' | 'admin_grant' | 'admin_deduct'
  -- 'gambling_spend' | 'gambling_win'          -- partagé par caisses, Blackjack, Crash et Tower
  -- 'auction_bid_hold' | 'auction_bid_refund' | 'auction_sale'
  -- 'motus_reward'
related_id INT,                        -- challenge_id, minigame_session_id, blackjack_hand_id, crash_bet_id, tower_game_id, auction_id… (nullable)
note TEXT,
affects_total_earned BOOLEAN NOT NULL DEFAULT TRUE,  -- migration 020 bis — voir plus bas
created_at TIMESTAMPTZ DEFAULT NOW(),
revoked_at TIMESTAMPTZ,                -- non NULL si le MSP a révoqué cette transaction
revoked_by INT REFERENCES users(id)
```
- Révoquer une transaction ne supprime jamais la ligne d'origine : elle est marquée `revoked_at`/`revoked_by`, et une transaction d'ajustement inverse (`admin_grant`/`admin_deduct`) est créée séparément via `creditSP`/`debitSP`. Impossible de révoquer une transaction dont la `season_id` pointe vers une saison `closed`, ni de révoquer deux fois la même transaction.
- `affects_total_earned` : permet à une mutation de ne toucher que `sp_balance` sans gonfler `sp_total_earned` (ex : transaction manuelle MSP marquée comme "prêt"/correction, remboursement d'enchère annulée) — sans ça, un remboursement se ferait passer pour un gain aux yeux du classement trié par total gagné. Par défaut `TRUE` (comportement historique). Historiquement, seuls les crédits (`amount > 0`) incrémentaient `sp_total_earned` ; les débits ne l'ont jamais touché — le backfill de la migration a mis `FALSE` sur tous les débits existants pour qu'une révocation future ne gonfle pas rétroactivement un total gagné.

### `challenges`
> Un défi peut avoir **plusieurs adversaires au sein du même défi** (pas plusieurs défis séparés) — voir [Système de défis](#4-système-de-défis-sp-wager) plus bas. La liste des participants (challenger inclus) vit dans `challenge_participants`, pas dans cette table.
```sql
id SERIAL PRIMARY KEY,
season_id INT REFERENCES seasons(id),
challenger_id INT REFERENCES users(id),  -- créateur du défi (toujours "accepted" dans challenge_participants)
wager_amount INT NOT NULL,               -- mise par joueur (identique pour tous les participants)
description TEXT,                        -- note libre du créateur
type VARCHAR(20) NOT NULL DEFAULT 'custom',  -- 'custom' | 'coin_flip' (migration 039), pas de CHECK — même logique que minigame_sessions.game_type
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
reported_winner_id INT REFERENCES users(id),    -- déclaration individuelle du gagnant ('custom' uniquement)
coin_side VARCHAR(10),                          -- 'pile' | 'face' — uniquement pour challenges.type = 'coin_flip' (migration 040)
responded_at TIMESTAMPTZ,
created_at TIMESTAMPTZ DEFAULT NOW(),
UNIQUE (challenge_id, user_id)
```

### `minigame_sessions`
```sql
id SERIAL PRIMARY KEY,
season_id INT REFERENCES seasons(id),
game_type VARCHAR(50) NOT NULL,       -- 'quiz' | 'flappy_bird'
title VARCHAR(255),                   -- ex: "Quiz Culture Générale #3"
description TEXT,
entry_fee INT,                        -- mise fixe débitée à l'entrée (migration 013), NULL = gratuit
status VARCHAR(20) DEFAULT 'open',    -- 'open' | 'closed' | 'cancelled'
ends_at TIMESTAMPTZ,                  -- deadline (spécifique à Flappy Bird — voir section 5.2)
reward_1st INT,                       -- récompenses fixes par rang (spécifiques à Flappy Bird)
reward_2nd INT,
reward_3rd INT,
created_by INT REFERENCES users(id), -- doit être admin (MSP)
created_at TIMESTAMPTZ DEFAULT NOW(),
closed_at TIMESTAMPTZ,
cancelled_at TIMESTAMPTZ,             -- annulation MSP avant clôture normale, sans distribution (migration 035)
cancelled_by INT REFERENCES users(id)
```
- `entry_fee`, `ends_at`, `reward_1st/2nd/3rd` sont nullables et spécifiques à un `game_type` donné (validation côté app, pas de `CHECK` conditionné par le type — même logique que `game_type` lui-même, pour ajouter facilement de futurs types). Ne pas confondre `reward_1st/2nd/3rd` (colonnes par session, Flappy Bird uniquement) avec les anciennes clés `admin_config` `minigame_reward_1st/2nd/3rd` (globales, supprimées migration 005) — ce sont deux mécanismes distincts à des époques différentes.

### `minigame_participants`
-- Un joueur rejoint lui-même une session ouverte (pas d'ajout manuel par défaut, même si le MSP peut aussi ajouter/retirer un participant depuis le panel). Concerne le quiz — Flappy Bird utilise `flappybird_attempts` à la place, pas de "participation" préalable requise.
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

### `flappybird_attempts`
-- Historique brut de chaque partie Flappy Bird jouée (traçabilité/audit — voir section 5.2). Pas d'unicité : un joueur peut rejouer tant que la session est `open` et que `ends_at` n'est pas dépassé.
```sql
id SERIAL PRIMARY KEY,
session_id INT REFERENCES minigame_sessions(id),
user_id INT REFERENCES users(id),
score INT NOT NULL CHECK (score >= 0),
played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
excluded_at TIMESTAMPTZ,              -- le MSP peut exclure une tentative suspecte avant clôture — jamais supprimée
excluded_by INT REFERENCES users(id)
```

### `gambling_crates`
-- Une "caisse" configurable par le MSP : coût fixe pour l'ouvrir, pool de récompenses associé.
```sql
id SERIAL PRIMARY KEY,
name VARCHAR(100) NOT NULL,
description TEXT,
image_url TEXT,
cost_sp INT NOT NULL,                  -- mise fixe pour ouvrir cette caisse ; 0 = gratuite, exige max_opens_per_player
max_opens_per_player INT,              -- NULL = illimité ; sinon nb max d'ouvertures par joueur
reset_interval_days INT,               -- NULL = max_opens_per_player est une limite à vie (défaut) ; sinon nb de jours entre deux resets (1 = quotidien, 7 = hebdo…), exige max_opens_per_player (migration 022)
is_active BOOLEAN NOT NULL DEFAULT TRUE,
created_by INT REFERENCES users(id),
created_at TIMESTAMPTZ DEFAULT NOW(),
requires_subscription BOOLEAN NOT NULL DEFAULT FALSE  -- ouverture réservée aux abonnés Ko-fi actifs (migration 023, section 8)
```

### `gambling_crate_rewards`
-- Pool de récompenses d'une caisse, tirage pondéré (poids, pas un % brut — évite de devoir recalculer les autres lignes à chaque ajout/retrait).
```sql
id SERIAL PRIMARY KEY,
crate_id INT REFERENCES gambling_crates(id),
type VARCHAR(20) NOT NULL,             -- 'sp' | 'custom' | 'cosmetic' (migration 024)
title VARCHAR(255) NOT NULL,
image_url TEXT,                        -- icône SP par défaut si type='sp', image dédiée si 'custom'
sp_amount INT,                         -- rempli uniquement si type='sp'
cosmetic_id INT REFERENCES cosmetics(id),        -- rempli si type='cosmetic' ET récompense précise
cosmetic_slot_filter VARCHAR(20),                -- OU récompense "pool" : filtre par emplacement (migration 028)
cosmetic_rarity_filter VARCHAR(20),              -- OU/ET filtre par rareté — voir section 10
weight INT NOT NULL,                   -- poids de tirage, normalisé en % à l'affichage
created_at TIMESTAMPTZ DEFAULT NOW()
```
- Une récompense `cosmetic` est **soit** précise (`cosmetic_id` seul), **soit** un pool (`cosmetic_id` NULL + au moins un des deux filtres) — jamais les deux, jamais ni l'un ni l'autre (contrainte `gambling_reward_sp_amount_consistent`, migration 028). Voir section 10 pour le tirage pondéré par rareté à l'intérieur d'un pool.

### `gambling_opens`
-- Historique de chaque ouverture (transparence/anti-triche).
```sql
id SERIAL PRIMARY KEY,
user_id INT REFERENCES users(id),
crate_id INT REFERENCES gambling_crates(id),
reward_id INT REFERENCES gambling_crate_rewards(id),
season_id INT REFERENCES seasons(id),
sp_transaction_id INT REFERENCES sp_transactions(id),  -- NULL si le gain tiré était de type 'custom' ou 'cosmetic'
opened_at TIMESTAMPTZ DEFAULT NOW()
```

### `gambling_inventory`
-- Collection persistante des gains 'custom' obtenus par un joueur (vitrine de profil). Un item reste acquis à vie, ce n'est pas un consommable. Les gains `cosmetic` vont dans `user_cosmetics` (section 10), pas ici.
```sql
id SERIAL PRIMARY KEY,
user_id INT REFERENCES users(id),
reward_id INT REFERENCES gambling_crate_rewards(id),
gambling_open_id INT REFERENCES gambling_opens(id),
obtained_at TIMESTAMPTZ DEFAULT NOW()
```

### `blackjack_sessions` / `blackjack_hands` (migrations 017–019)
-- Blackjack multijoueur tour par tour : une seule table "vivante" à la fois, pas de lobby nommé, pas de pot commun — chaque joueur mise ce qu'il veut et joue sa propre main contre le croupier. Voir section 7.1.
```sql
-- blackjack_sessions
id SERIAL PRIMARY KEY,
season_id INT REFERENCES seasons(id),
status VARCHAR(20) NOT NULL DEFAULT 'waiting',  -- 'waiting' | 'active' | 'finished'
starts_at TIMESTAMPTZ,           -- 1re mise + 15s ; NULL tant qu'aucune mise
started_at TIMESTAMPTZ,
finished_at TIMESTAMPTZ,
dealer_cards JSONB NOT NULL DEFAULT '[]',
dealer_hole_revealed BOOLEAN NOT NULL DEFAULT FALSE,
current_hand_id INT REFERENCES blackjack_hands(id),  -- main dont c'est le tour ; NULL = personne à jouer (migration 019)
created_at TIMESTAMPTZ DEFAULT NOW()

-- blackjack_hands
id SERIAL PRIMARY KEY,
session_id INT REFERENCES blackjack_sessions(id),
user_id INT REFERENCES users(id),
bet_amount INT NOT NULL CHECK (bet_amount > 0),
cards JSONB NOT NULL DEFAULT '[]',
status VARCHAR(20) NOT NULL DEFAULT 'playing',   -- 'playing' | 'stood' | 'busted'
outcome VARCHAR(20),                              -- NULL tant qu'en cours ; 'win' | 'blackjack' | 'push' | 'lose'
bet_transaction_id INT REFERENCES sp_transactions(id),
payout_transaction_id INT REFERENCES sp_transactions(id),
action_deadline TIMESTAMPTZ,      -- fixé à la distribution ; auto-stand si dépassé
joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
resolved_at TIMESTAMPTZ,
UNIQUE (session_id, user_id)
```

### `crash_rounds` / `crash_bets` (migration 038)
-- Une seule manche "vivante" à la fois, même pattern que le Blackjack. Voir section 7.2. Multiplicateurs stockés en entier ×100 (234 = 2.34x) plutôt qu'en NUMERIC — évite le parsing de chaîne que `pg` renvoie par défaut pour NUMERIC, et reste dans l'esprit "SP toujours en entier".
```sql
-- crash_rounds
id SERIAL PRIMARY KEY,
season_id INT REFERENCES seasons(id),
status VARCHAR(20) NOT NULL DEFAULT 'betting',  -- 'betting' | 'running' | 'crashed'
crash_point_x100 INT NOT NULL,  -- tiré à la création, caché du client tant que status != 'crashed'
starts_at TIMESTAMPTZ,          -- 1re mise + 10s (BETTING_WINDOW_SECONDS) ; NULL tant qu'aucune mise
started_at TIMESTAMPTZ,         -- passage à 'running'
crashed_at TIMESTAMPTZ,         -- instant du crash, calculé dès le passage à 'running'
created_at TIMESTAMPTZ DEFAULT NOW()

-- crash_bets
id SERIAL PRIMARY KEY,
round_id INT REFERENCES crash_rounds(id),
user_id INT REFERENCES users(id),
bet_amount INT NOT NULL CHECK (bet_amount > 0),
cashout_multiplier_x100 INT,    -- NULL tant que non retiré ; figé au retrait, jamais rempli si emporté par le crash
bet_transaction_id INT REFERENCES sp_transactions(id),
payout_transaction_id INT REFERENCES sp_transactions(id),
joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
resolved_at TIMESTAMPTZ,        -- fixé au retrait, ou au crash pour ceux qui n'ont pas retiré à temps
UNIQUE (round_id, user_id)
```

### `tower_games` (migration 041)
-- Jeu de progression solo (façon csgofast) : contrairement au Blackjack/Crash, pas de manche partagée — chaque partie est individuelle, avancée case par case par le joueur lui-même. Voir section 7.3.
```sql
id SERIAL PRIMARY KEY,
user_id INT REFERENCES users(id),
season_id INT REFERENCES seasons(id),
difficulty VARCHAR(20) NOT NULL,       -- 'easy' | 'medium' | 'hard'
bet_amount INT NOT NULL CHECK (bet_amount > 0),
status VARCHAR(20) NOT NULL DEFAULT 'in_progress',  -- 'in_progress' | 'cashed_out' | 'busted'
current_level INT NOT NULL DEFAULT 0,
mine_positions JSONB NOT NULL,   -- tableau (un par étage) de positions minées, jamais révélé tant que l'étage n'est pas franchi/la partie finie
picks JSONB NOT NULL DEFAULT '[]', -- case choisie pour chaque étage déjà franchi
bet_transaction_id INT REFERENCES sp_transactions(id),
payout_transaction_id INT REFERENCES sp_transactions(id),
created_at TIMESTAMPTZ DEFAULT NOW(),
resolved_at TIMESTAMPTZ
```
- Un seul index unique partiel garantit **une seule partie `in_progress` à la fois par joueur** (empêche un double `/start` — deux onglets, double clic — de débiter deux fois la même mise).

### `cosmetics` / `user_cosmetics` (migrations 024–030)
-- Cosmétiques équipables (cadres d'avatar, bannières, couleur de pseudo, police de pseudo, titre) : purement visuels, distincts des gains `custom` du gambling qui restent des trophées de collection non-équipables. Voir section 10.
```sql
-- cosmetics (le catalogue, géré par le MSP)
id SERIAL PRIMARY KEY,
slot VARCHAR(20) NOT NULL,   -- 'avatar_frame' | 'banner' | 'name_color' | 'title' | 'name_font'
key VARCHAR(50) UNIQUE NOT NULL,
name VARCHAR(100) NOT NULL,
description TEXT,
image_url TEXT,              -- cadre/bannière ; NULL pour name_color/title/name_font
color_value VARCHAR(20),     -- hex — utilisé par name_color, et par title pour teinter le texte (migration 027)
font_family TEXT,            -- chaîne CSS font-family — utilisé par name_font (migration 026)
rarity VARCHAR(20) NOT NULL DEFAULT 'common',  -- 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' (migration 030)
is_default BOOLEAN NOT NULL DEFAULT FALSE,     -- fallback implicite par emplacement, un seul par slot, jamais supprimable
created_by INT REFERENCES users(id),
created_at TIMESTAMPTZ DEFAULT NOW()

-- user_cosmetics (ce qu'un joueur possède/équipe)
id SERIAL PRIMARY KEY,
user_id INT NOT NULL REFERENCES users(id),
cosmetic_id INT NOT NULL REFERENCES cosmetics(id),
slot VARCHAR(20) NOT NULL,   -- dénormalisé depuis cosmetics.slot, pour l'index d'unicité d'équipement
equipped BOOLEAN NOT NULL DEFAULT FALSE,
quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 0),  -- empilable (migration 031) — voir section 10
obtained_source VARCHAR(30) NOT NULL,  -- 'gambling' | 'admin_grant'
obtained_at TIMESTAMPTZ DEFAULT NOW(),
UNIQUE (user_id, cosmetic_id)
```
- Un seul cosmétique équipé par emplacement et par joueur (index unique partiel `equipped = true`), un seul défaut par emplacement (index unique partiel `is_default = true`).
- Un joueur ne "possède" pas forcément le cosmétique `is_default` de chaque emplacement : il sert de repli implicite quand rien n'est équipé, pour éviter d'insérer une ligne `user_cosmetics` pour chaque joueur à chaque nouveau défaut.
- **Empilable** (`quantity`) : un gain en double (caisse ou octroi MSP) incrémente `quantity` plutôt que d'être ignoré. À 0 (après revente complète en enchère) la ligne est conservée plutôt que supprimée — même principe "jamais de suppression" que les transactions révoquées ou les défis annulés.

### `cosmetic_auctions` / `cosmetic_auction_bids` (migration 031)
-- Enchères entre joueurs, un exemplaire d'un cosmétique précis à la fois, durée fixée par le vendeur, résolution paresseuse (check à la lecture, même pattern que l'expiration des défis 24h). Voir section 11.
```sql
-- cosmetic_auctions
id SERIAL PRIMARY KEY,
seller_id INT NOT NULL REFERENCES users(id),
cosmetic_id INT NOT NULL REFERENCES cosmetics(id),
starting_price INT NOT NULL CHECK (starting_price > 0),
current_bid INT,
current_bidder_id INT REFERENCES users(id),
status VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active' | 'sold' | 'expired' | 'cancelled'
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ends_at TIMESTAMPTZ NOT NULL,
resolved_at TIMESTAMPTZ,
cancelled_by INT REFERENCES users(id),  -- MSP uniquement, voir section 11
cancelled_at TIMESTAMPTZ

-- cosmetic_auction_bids
id SERIAL PRIMARY KEY,
auction_id INT NOT NULL REFERENCES cosmetic_auctions(id),
bidder_id INT NOT NULL REFERENCES users(id),
amount INT NOT NULL CHECK (amount > 0),
status VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active' | 'refunded' | 'won'
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
hold_transaction_id INT REFERENCES sp_transactions(id),
refund_transaction_id INT REFERENCES sp_transactions(id)
```

### `motus_word_queue` / `motus_daily_words` / `motus_attempts` (migrations 042–044)
-- Motus (façon Wordle) : un mot commun à tous les joueurs par date locale Europe/Paris. Voir section 12.
```sql
-- motus_word_queue — file de mots configurés par le MSP, consommée en FIFO (ou par `position` explicite, migration 044)
id SERIAL PRIMARY KEY,
word VARCHAR(20) NOT NULL CHECK (word ~ '^[A-Z]{3,12}$'),  -- A-Z uniquement, pas d'accents
position INT NOT NULL DEFAULT 0,   -- ordre de file réordonnable par le MSP
added_by INT REFERENCES users(id),
used_at TIMESTAMPTZ,               -- non NULL une fois consommé ; reste en base pour l'historique
created_at TIMESTAMPTZ DEFAULT NOW()

-- motus_daily_words — un mot par jour local, figé une fois créé (UNIQUE(word_date))
id SERIAL PRIMARY KEY,
word_date DATE NOT NULL UNIQUE,
word VARCHAR(20) NOT NULL CHECK (word ~ '^[A-Z]{3,12}$'),
queue_id INT REFERENCES motus_word_queue(id),  -- NULL si généré aléatoirement ou remplacé manuellement
source VARCHAR(10) NOT NULL DEFAULT 'random',  -- 'queue' | 'random' | 'manual' (migration 044)
season_id INT REFERENCES seasons(id),
created_at TIMESTAMPTZ DEFAULT NOW()

-- motus_attempts — une tentative par joueur par mot du jour, numérotée et verrouillée
id SERIAL PRIMARY KEY,
daily_word_id INT NOT NULL REFERENCES motus_daily_words(id),
user_id INT NOT NULL REFERENCES users(id),
attempt_number INT NOT NULL CHECK (attempt_number > 0),
guess VARCHAR(20) NOT NULL,
result JSONB NOT NULL,        -- tableau par lettre : 'correct' | 'present' | 'absent'
is_correct BOOLEAN NOT NULL,
created_at TIMESTAMPTZ DEFAULT NOW(),
UNIQUE (daily_word_id, user_id, attempt_number)
```

### `subscriptions`
-- Abonnement (financement des serveurs) encaissé hors-plateforme via Ko-fi, don ponctuel ou récurrent, prix fixé sur la page Ko-fi elle-même — voir section 8.
```sql
id SERIAL PRIMARY KEY,
user_id INT NOT NULL UNIQUE REFERENCES users(id),
status VARCHAR(20) NOT NULL DEFAULT 'inactive',  -- 'inactive' | 'active'
link_code VARCHAR(12) NOT NULL UNIQUE,  -- collé dans le message du 1er paiement Ko-fi pour relier le compte
kofi_email TEXT,                        -- capturé au 1er paiement matché, réutilisé pour les renouvellements
current_period_end TIMESTAMPTZ,         -- accès actif tant que non dépassé
last_payment_at TIMESTAMPTZ,
activated_by INT REFERENCES users(id),  -- MSP si activé/prolongé manuellement, NULL si via webhook Ko-fi
created_at TIMESTAMPTZ DEFAULT NOW(),
updated_at TIMESTAMPTZ DEFAULT NOW()
```
- Une ligne n'existe que pour les joueurs ayant consulté la section Abonnement de leur profil au moins une fois (création paresseuse, pas de hook à l'inscription).
- Pas de statut "annulé" actif : Ko-fi ne notifie que les paiements réussis, jamais les résiliations — l'accès expire donc de lui-même à `current_period_end` faute de renouvellement, plutôt que d'être révoqué en réaction à un événement.

### `kofi_events`
-- Historique brut de chaque paiement Ko-fi reçu (idempotence sur les retries de webhook + file d'attente de rattachement manuel MSP).
```sql
id SERIAL PRIMARY KEY,
kofi_transaction_id TEXT NOT NULL UNIQUE,
message_id TEXT NOT NULL,
type VARCHAR(30) NOT NULL,              -- 'Subscription' | 'Donation' | 'Shop Order' | 'Commission'…
is_subscription_payment BOOLEAN NOT NULL,
is_first_subscription_payment BOOLEAN NOT NULL,  -- seul paiement où Ko-fi fournit le champ message
from_name TEXT,
email TEXT,
amount NUMERIC(10, 2),
currency VARCHAR(10),
message TEXT,
tier_name TEXT,
kofi_timestamp TIMESTAMPTZ NOT NULL,
matched_user_id INT REFERENCES users(id),  -- NULL si non rattaché (code de liaison absent/invalide)
raw_payload JSONB NOT NULL,
received_at TIMESTAMPTZ DEFAULT NOW()
```

### `notifications`
```sql
id SERIAL PRIMARY KEY,
user_id INT REFERENCES users(id),
type VARCHAR(50) NOT NULL,
  -- 'challenge_received' | 'challenge_accepted' | 'challenge_declined' | 'challenge_resolved'
  -- 'challenge_cancelled' | 'challenge_expired' | 'minigame_open' | 'minigame_cancelled'
  -- 'sp_gained' | 'sp_lost' | 'cosmetic_earned'
  -- 'auction_outbid' | 'auction_won' | 'auction_sold' | 'auction_expired' | 'auction_cancelled'
  -- 'suggestion_comment' | 'suggestion_closed'
  -- 'motus_reward' n'existe PAS comme notification — le résultat s'affiche en direct dans la grille, pas de notif séparée
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
--   max_wager_amount              (défaut: 10)
--   max_challenges_per_day        (défaut: 2)
--   login_bonus_base              (défaut: 5)
--   streak_bonus_step             (SP bonus par palier de streak, défaut: 2)
--   streak_bonus_max              (plafond du bonus streak, défaut: 30)
--   streak_required_days          (nb jours consécutifs par palier, défaut: 3)
--   gambling_enabled               (active/désactive les caisses, indépendant de blackjack/crash/tower, défaut: true)
--   gambling_max_wager_per_day     (SP total misé/jour, tous jeux gambling confondus — caisses + Blackjack + Crash + Tower, défaut: 50)
--   blackjack_enabled              (défaut: false — désactivé tant que le MSP ne l'active pas explicitement, migration 018)
--   crash_enabled                  (défaut: false, migration 038)
--   tower_enabled                  (défaut: false, migration 041)
--   discord_notifications_enabled  (alerte Discord au lancement d'un mini-jeu, défaut: false, migration 020)
--   cosmetic_rarity_weight_common/uncommon/rare/epic/legendary  (poids de tirage relatifs pour une récompense caisse "pool" cosmétique — voir section 10, migrations 028/030)
--   auction_min_duration_minutes / auction_max_duration_minutes  (bornes de durée d'une enchère, défauts 5 / 4320, migration 033 — remplace les anciennes clés en heures)
--   auction_min_bid_increment      (surenchère minimale en SP, défaut: 1)
--   motus_reward_sp                (SP gagnés en trouvant le mot du jour, défaut: 5)
--   motus_max_attempts             (tentatives max par joueur par jour, défaut: 6)
--   kofi_subscription_period_days  (durée en jours de validité d'un abonnement après paiement, défaut: 35)
-- Note : minigame_reward_1st/2nd/3rd (clés globales) ont existé puis ont été supprimées (migration 005) —
-- l'attribution des SP en quiz est un montant libre par joueur. Ne pas confondre avec les colonnes
-- reward_1st/2nd/3rd de minigame_sessions (par session, Flappy Bird uniquement, migration 034).
```

### `suggestions`
-- Page "Suggestions" : les joueurs proposent des features/bugs, votent, commentent (section 9).
```sql
id SERIAL PRIMARY KEY,
author_id INT REFERENCES users(id),
type VARCHAR(20) NOT NULL DEFAULT 'feature',  -- 'feature' | 'bug'
title VARCHAR(200) NOT NULL,
description TEXT,
status VARCHAR(20) NOT NULL DEFAULT 'open',   -- 'open' | 'closed'
closed_at TIMESTAMPTZ,
closed_by INT REFERENCES users(id),
created_at TIMESTAMPTZ DEFAULT NOW()
```

### `suggestion_votes`
-- Vote façon Reddit (up **et** down depuis la migration 037), un vote par joueur par suggestion (toggle).
```sql
id SERIAL PRIMARY KEY,
suggestion_id INT REFERENCES suggestions(id) ON DELETE CASCADE,
user_id INT REFERENCES users(id),
value SMALLINT NOT NULL,  -- 1 (up) ou -1 (down)
created_at TIMESTAMPTZ DEFAULT NOW(),
UNIQUE (suggestion_id, user_id)
```

### `suggestion_comments`
```sql
id SERIAL PRIMARY KEY,
suggestion_id INT REFERENCES suggestions(id) ON DELETE CASCADE,
author_id INT REFERENCES users(id),
body TEXT NOT NULL,
created_at TIMESTAMPTZ DEFAULT NOW()
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
- Profil public : avatar, username, solde SP, stats de la saison active, cosmétiques équipés (cadre, bannière, couleur/police de pseudo, titre — voir section 10), vitrine des gains `custom` (gambling)
- Profil privé (connecté) : historique des transactions, défis, mini-jeux, ses cosmétiques (équiper/déséquiper), section Abonnement (Ko-fi, voir section 8)

### 2. Leaderboard

- **Saison active** uniquement par défaut
- Tri sélectionnable par l'utilisateur :
  - `sp_balance` — Solde actuel (**défaut**)
  - `sp_total_earned` — Total gagné (all-time sur la saison)
- Colonnes : rang, avatar, username, solde SP, total gagné
- Rafraîchissement toutes les **60 secondes** (polling)
- Page "Archives" : sélectionner une saison passée → affiche le `season_snapshot` (route `/archives` redirige désormais vers `/classement`, qui porte les deux vues)
- **Visibilité MSP** : un admin peut se rendre invisible du classement (`is_leaderboard_hidden`). Il n'apparaît plus dans le leaderboard, les `season_snapshot`, ni dans le calcul de rang des autres joueurs (un MSP caché avec un gros solde n'occupe pas un rang). Son propre rang devient alors `null` ("Hors classement"). Profil et transactions restent consultables normalement.

### 3. Bonus de connexion quotidienne + Streak

- **Réclamé manuellement par le joueur** via un bouton "Réclamer" sur son profil (`POST /api/users/me/claim-daily-bonus`) — plus d'auto-crédit silencieux à la première requête authentifiée de la journée (comportement initial abandonné à la demande explicite de l'utilisateur). Idempotent par date **locale (Europe/Paris)**, pas UTC : un second appel le même jour renvoie `alreadyClaimed: true` sans re-créditer ; le bouton disparaît côté client dès que `last_login_date` correspond à aujourd'hui (Europe/Paris).
- **Reset à minuit heure de Paris, pas 24h glissantes après la dernière réclamation** (décision explicite de l'utilisateur — auparavant en UTC, ce qui décalait le reset à 1h/2h du matin heure française selon l'heure d'été/hiver). Côté serveur, `todayLocal()` dans `server/src/utils/localDate.ts` (utilitaire partagé, réutilisé aussi par le budget gambling journalier — section 7 — et par le mot du jour Motus — section 12) utilise `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' })`, qui gère nativement le passage CET/CEST — pas de calcul d'offset manuel. Le client (`Profile.tsx`) a sa propre copie de la même logique (`Intl.DateTimeFormat` côté navigateur) pour décider quand cacher le bouton "Réclamer" sans appel serveur. C'est une **exception délibérée** à la règle "tout en UTC" ci-dessous, limitée aux frontières de journée qui doivent coller au ressenti des joueurs — tout le reste de l'app (transactions, sessions, etc.) reste en UTC.
- Montant de base : `login_bonus_base` SP (configurable par le MSP)
- **Système de streak** :
  - Si l'utilisateur s'est connecté la veille, le streak augmente de 1
  - Si non, le streak repart à 1
  - Bonus supplémentaire : `floor(streak / streak_required_days) × streak_bonus_step` SP, plafonné à `streak_bonus_max`
  - Exemple avec défauts (step=2, required=3, max=30) : streak 1–2 → +0 SP, 3–5 → +2 SP, 6–8 → +4 SP, 45+ → +30 SP (plafond)
- Chaque bonus génère une entrée dans `sp_transactions` (type `login_bonus`, note indique le streak)
- Le streak et les paramètres sont modifiables par le MSP (admin_config + reset manuel possible)

> **Pièges d'implémentation rencontrés** (à garder en tête pour toute modif de cette logique) :
> - **Race condition** : plusieurs clics/onglets peuvent appeler `claim-daily-bonus` en parallèle pour le même joueur, chacun lisant `last_login_date` avant qu'aucun ne l'ait réécrit → double/triple crédit. Toute la séquence check-then-act doit être dans une seule transaction avec `SELECT ... FOR UPDATE` sur la ligne user ; `creditSP`/`debitSP` acceptent un `client` (PoolClient) optionnel pour rejoindre cette transaction plutôt que d'en ouvrir une nouvelle (sinon deadlock).
> - **Parsing de `DATE` par `pg`** : node-postgres convertit par défaut une colonne `DATE` en objet `Date` construit avec les composantes *locales*, ce qui décale silencieusement la date d'un jour dans les fuseaux UTC+ (France) une fois reconverti en UTC — casse totalement la comparaison "connecté hier ?". Le parser du type `DATE` est neutralisé globalement dans `server/src/db/pool.ts` (`types.setTypeParser(types.builtins.DATE, v => v)`), pour garder les dates comme simples chaînes `'YYYY-MM-DD'`.
> - **Même piège pour NUMERIC** : `pg` renvoie une colonne `NUMERIC` sous forme de chaîne par défaut (pas de parser custom en place, contrairement à `DATE`). Crash et Tower l'évitent entièrement en stockant leurs multiplicateurs en `INT` ×100 (ex: `234` = 2.34x) plutôt qu'en `NUMERIC` — reste un `number` JS natif de bout en bout, dans l'esprit "SP toujours en entier".

### 4. Système de défis (SP Wager)

Un défi peut réunir **plusieurs adversaires au sein d'un même défi** (un seul pot commun, un seul gagnant), pas plusieurs défis 1v1 séparés. Le cas 1 challenger + 1 adversaire est simplement le cas N=2 de ce modèle général — l'économie SP est identique à l'ancien système 1v1.

#### Types de défi (`challenges.type`, migration 039)
- **`custom`** (défaut, comportement historique décrit ci-dessous) : le résultat est déclaré manuellement par les participants (consensus) ou arbitré par le MSP.
- **`coin_flip`** (pile ou face) : se joue exclusivement à **deux** (un seul adversaire invité, pas de N joueurs — un vrai pile ou face n'a que deux faces). C'est le joueur **défié** (jamais le challenger) qui choisit son côté (`challenge_participants.coin_side`, migration 040) au moment d'accepter — décision explicite de l'utilisateur, le choix appartient à celui qui subit le défi ; le challenger hérite automatiquement du côté opposé. Dès que l'adversaire accepte (et choisit son côté), le défi ne passe jamais visiblement par l'état `accepted` : le serveur tire immédiatement un gagnant au hasard (`Math.random()`, jamais côté client — même principe que le tirage pondéré du gambling) et résout le défi dans la même requête, en réutilisant `resolveChallenge` (agnostique du type). Aucune déclaration manuelle possible pour ce type — le contrôleur ne propose pas l'UI de report. L'expiration à 24h ne peut jamais faire basculer un `coin_flip` vers `accepted` (avec un seul adversaire, l'issue est soit une réponse explicite soit un refus/expiration vers `declined`), donc le seul point de déclenchement du tirage est `acceptChallenge`.

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

### 5. Mini-Jeux

Deux `game_type` cohabitent dans `minigame_sessions`, avec des flux très différents. Les fonctionnalités MSP sont visibles uniquement pour les admins, directement dans la page joueur (`/mini-jeux`, `/mini-jeux/:id`) — pas de page `/admin/mini-jeux` séparée.

#### 5.1 Quiz en direct (`game_type = 'quiz'`)

> Ce système a été repensé en cours de projet : la version initiale (MSP saisit des résultats obtenus hors-plateforme, récompenses fixes par rang 🥇🥈🥉) a été remplacée par un quiz interactif en direct, à la demande explicite de l'utilisateur.

- Le MSP crée une session : type de jeu, titre, description, et optionnellement un **droit d'entrée** (`entry_fee`, migration 013) débité au moment où un joueur rejoint, indépendamment des SP qui lui seront ensuite librement attribués.
- La session passe en `open` → visible par tous les joueurs. Si `discord_notifications_enabled` est actif, une alerte est envoyée sur un webhook Discord (voir section 6bis).
- **N'importe quel joueur peut rejoindre lui-même** la session (`minigame_participants`, self-join) — le MSP peut aussi ajouter/retirer un participant manuellement depuis le panel
- Le MSP affiche une question à la fois (`minigame_questions`, statut `active`) ; en poser une nouvelle clôture automatiquement la précédente
- Les joueurs voient la question en temps réel (polling) et soumettent une réponse libre — **verrouillée une fois soumise**, pas de modification possible
- Le temps de réponse (`seconds_to_answer`) est calculé côté serveur
- **Confidentialité des réponses** : le texte d'une réponse n'est visible que par le MSP et par son auteur ; les autres joueurs voient seulement que la personne "a répondu" + son temps, jamais le contenu (sérialisation role-aware côté contrôleur)
- Le MSP peut clôturer la question en cours à tout moment
- Une fois la question (ou la session) close, le MSP attribue un **montant SP libre** à chaque participant, joueur par joueur — pas de montant fixe par rang, pas de lien automatique avec la rapidité de réponse. Chaque attribution génère une transaction `minigame_reward`.
- Le MSP clôture la session (`closed`) une fois les SP attribués. Un historique des questions posées reste consultable dans la session (`GET /:id/questions`)

#### 5.2 Flappy Bird (`game_type = 'flappy_bird'`, migration 034)

- Jeu solo embarqué en iframe (NanoForge), classement par **meilleur score**, distribution de récompenses **fixes par rang** (`reward_1st`/`2nd`/`3rd` sur la session, montant libre défini par le MSP) une fois la `ends_at` (deadline) passée — contrairement au quiz, pas de montant libre par joueur.
- **Anti-triche par jeton signé, pas de confiance dans un score déclaré par le client** : le client n'envoie jamais de score final brut. `POST /:id/start` émet un JWT (`FlappyBirdAttemptToken`, TTL 30 min, `server/src/utils/jwt.ts`) avec `score: 0`. Chaque point marqué en jeu (un tuyau passé) appelle `POST /:id/point` avec le jeton courant ; le serveur vérifie un délai minimum réel écoulé depuis l'émission (`flappybirdService.minDelayForNextPoint(score)`) avant de réémettre un jeton avec `score + 1`. `POST /:id/submit` n'accepte que `attempt.score` extrait du jeton final — jamais un champ fourni par le client. Forger un score élevé exige donc d'envoyer autant de requêtes authentifiées, correctement espacées dans le temps réel, qu'il y a de points.
- Chaque tentative est tracée dans `flappybird_attempts` (pas d'unicité : un joueur peut rejouer tant que la session est `open` et `ends_at` non dépassée). Le MSP peut **exclure** une tentative suspecte avant la clôture (`excluded_at`/`excluded_by`) — jamais supprimée, même principe que la révocation de transaction.
- Le MSP peut **annuler** une session Flappy Bird (`cancelled`, migration 035) pendant qu'elle est encore ouverte, sans distribuer aucun gain — distinct de `closed` (clôture normale avec distribution). Notifie les participants (`minigame_cancelled`).

### 6. Notifications & synchronisation temps réel

- Pas de WebSocket (décision assumée) : tout est en **polling**, à des intervalles courts et propres à chaque écran :
  - Cloche de notifications (`NotificationBell.tsx`) : compte + liste ensemble toutes les **10s**
  - Défis, joueur (`Challenges.tsx`) : **5s** normalement, **1s** pendant qu'un défi `coin_flip` attend sa résolution (`COIN_FLIP_POLL_INTERVAL_MS`)
  - Défis, admin (`admin/Challenges.tsx`) : **5s**
  - Session mini-jeu ouverte, quiz (`MinigameDetail.tsx`) : **2s** tant que la session est `open`
  - Solde/streak utilisateur (`useAuth`) : **15s**
  - Transactions récentes du profil (`Profile.tsx`) : **10s**
  - Suggestion (détail, `SuggestionDetail.tsx`) : **10s**
  - Table Blackjack (`BlackjackTable.tsx`) : **1s**
  - Manche Crash (`Crash.tsx`) : **1s** en phase `betting`/`crashed`, **300ms** en phase `running` (le multiplicateur grimpe vite, il faut un retrait réactif)
  - Enchère (liste `Auctions.tsx` et détail `AuctionDetail.tsx`) : **5s**
  - Motus, Tower et Flappy Bird ne pollent pas : ce sont des parties strictement individuelles avancées par les propres appels du joueur, rien à synchroniser avec d'autres joueurs pendant la partie
- Une notification (`notifications`, type + message + `link` de redirection) est créée pour : défi reçu/accepté/décliné/résolu/annulé/expiré, mini-jeu ouvert/annulé, gain de SP, perte de SP, cosmétique gagné, enchère surenchérie/gagnée/vendue/expirée/annulée, commentaire/clôture de suggestion
- Toujours déclenchée depuis les **contrôleurs**, jamais depuis les services (les services ne connaissent pas la couche notification)

#### 6bis. Alerte Discord (webhook sortant, migration 020)

- Au lancement d'une session de quiz, une alerte optionnelle est postée sur un salon Discord via webhook (`discord.service.ts`). Concerne uniquement le quiz pour l'instant (`GAME_TYPE_LABELS` n'a qu'une entrée `'quiz'`).
- `DISCORD_WEBHOOK_URL` (et optionnellement `DISCORD_ALERT_ROLE_ID` pour taguer un rôle) vivent dans `server/.env`, **jamais** en BDD ni exposés via `admin_config` : un webhook Discord est un secret (quiconque le possède peut poster dans le salon), contrairement aux clés `admin_config` éditables en clair depuis le panel MSP.
- Le toggle `discord_notifications_enabled` (BDD, défaut `false`) permet au MSP de couper l'alerte sans toucher aux secrets. Une alerte ratée (webhook down, mal configuré) ne fait jamais échouer la création du mini-jeu — erreur avalée et journalisée côté serveur.

### 7. Gambling — Case Opening, Blackjack, Crash, Tower

Quatre jeux d'argent virtuel cohabitent sous `/gambling`, avec un seul **budget quotidien partagé** (`gambling_max_wager_per_day`) mais des **interrupteurs indépendants** (`gambling_enabled` pour les caisses, `blackjack_enabled`, `crash_enabled`, `tower_enabled`) — chaque jeu ajouté après les caisses est désactivé par défaut tant que le MSP ne l'active pas explicitement dans `/admin/config`. Contrôles MSP visibles seulement si `user.role === 'admin'` — même pattern que les Mini-Jeux, pas de page `/admin/gambling` séparée.

Routes joueur : `/gambling` (hub), `/gambling/crates`, `/gambling/crates/:id`, `/gambling/blackjack`, `/gambling/crash`, `/gambling/tower`.

Tous les quatre réutilisent les types `sp_transactions` existants (`gambling_spend`/`gambling_win`) plutôt que d'en ajouter — pas de plafond séparé par jeu, un seul levier économique (décision explicite de garder ce système simple).

#### 7.0 Case Opening

- Le MSP configure une ou plusieurs **caisses** (`gambling_crates`) : nom, description, image, coût fixe (`cost_sp`) pour l'ouvrir, et optionnellement un nombre max d'ouvertures par joueur (`max_opens_per_player`, NULL = illimité — ex : caisse événement limitée à 3 ouvertures/joueur). Une fois la limite atteinte, le bouton d'ouverture est désactivé côté client et le serveur refuse quand même la requête (mêmes verrous que le plafond quotidien).
- Cette limite d'ouvertures est **à vie par défaut** (comptée sur tout l'historique `gambling_opens`, jamais remise à zéro par saison), mais le MSP peut optionnellement lui associer un `reset_interval_days` (ex : 1 = quotidien, 3 = tous les 3 jours, 7 = hebdomadaire) — la limite se réinitialise alors automatiquement à intervalle régulier. `reset_interval_days` exige `max_opens_per_player` (contrainte `gambling_crates_reset_requires_limit`). Les périodes de reset sont calculées côté SQL par `gambling_period_start(interval_days)`, ancrées sur l'epoch Unix en heure locale Europe/Paris (même exception délibérée que le bonus quotidien) : avec un intervalle de 1 jour ça reproduit exactement un reset à minuit local.
- **Caisse gratuite** (`cost_sp = 0`) : autorisée **uniquement** si `max_opens_per_player` est défini (contrainte BDD `gambling_crates_free_requires_limit`). Une ouverture gratuite ne débite rien et n'entame pas le budget gambling quotidien.
- Chaque caisse a un pool de récompenses (`gambling_crate_rewards`) configuré librement par le MSP :
  - **Gain SP classique** (`type='sp'`) : montant SP fixe.
  - **Gain personnalisé** (`type='custom'`) : titre + image, **sans valeur SP** — purement cosmétique/collection (vitrine `gambling_inventory`), aucun effet sur l'économie.
  - **Gain cosmétique équipable** (`type='cosmetic'`, migration 024) : soit un cosmétique précis (`cosmetic_id`), soit un **pool** filtré par emplacement et/ou rareté (migration 028) — voir section 10 pour le tirage pondéré à l'intérieur du pool.
  - Chaque récompense a un poids de tirage (`weight`) ; le MSP peut voir le poids normalisé en % dans l'UI.
- Le tirage est **pondéré et effectué côté serveur uniquement** (jamais côté client).
- Le MSP peut **supprimer** une caisse (et son pool) uniquement si elle n'a **jamais été ouverte** — sinon `gambling_opens` y référerait des lignes fantômes. Une caisse déjà ouverte au moins une fois ne peut plus être qu'**archivée** (`is_active = false`), jamais supprimée. Même règle pour un gain individuel du pool (`removeReward`).
- **Archivage** : une caisse archivée disparaît de la liste des joueurs sans perdre son historique. Côté MSP, un bouton « Voir les caisses archivées » (opt-in, replié par défaut) les fait réapparaître. Réversible à tout moment.

##### Flux d'ouverture :
1. Vérifier `gambling_enabled`, le solde du joueur, et que la mise du jour (tous jeux gambling confondus) + `cost_sp` ne dépasse pas `gambling_max_wager_per_day`.
2. Débiter `cost_sp` (transaction `gambling_spend`, **toujours**, quel que soit le résultat) — sauf si `cost_sp = 0`.
3. Tirer une récompense pondérée dans le pool.
4. Si `type='sp'` → créditer (`gambling_win`) ; si `type='custom'` → `gambling_inventory` ; si `type='cosmetic'` → `user_cosmetics` (section 10) — aucune transaction SP pour `custom`/`cosmetic`.
5. Enregistrer l'ouverture dans `gambling_opens` (traçabilité/anti-triche).

#### 7.1 Blackjack (migrations 017–019)

- Multijoueur, **tour par tour** (`blackjack_sessions.current_hand_id` pointe la main dont c'est le tour ; `NULL` = personne à faire jouer). Pas de lobby nommé, pas de pot commun : chaque joueur mise ce qu'il veut et joue sa propre main contre le croupier.
- État avancé **"à la lecture"** (même pattern que l'expiration des défis) — pas de cron : `JOIN_WINDOW_SECONDS = 15` après la 1ère mise avant démarrage, `ACTION_TIMEOUT_SECONDS = 20` de délai de décision par main (auto-stand si dépassé), `RESULTS_DISPLAY_SECONDS = 6` d'affichage des résultats avant qu'une nouvelle table ne s'ouvre.
- Résolution : le croupier tire tant que `dealerShouldHit` (règle standard, tire sous 17). Gains : `blackjack` naturel paie 3:2 (`mise + floor(mise × 1.5)`, arrondi à l'entier inférieur — SP toujours en entier), `win` paie 2:1 (mise rendue + gain égal), `push` (égalité) rend la mise, `lose`/`busted` ne rend rien. Une transaction `gambling_win` par main gagnante/push, la mise déjà débitée en `gambling_spend` à l'entrée.

#### 7.2 Crash (migration 038)

- Une seule manche "vivante" à la fois, même pattern "à la lecture" que le Blackjack. `BETTING_WINDOW_SECONDS = 10` après la 1ère mise avant le décollage. Le multiplicateur grimpe de façon déterministe et **identique côté serveur et client** (`multiplierAt(elapsedSeconds)`, `GROWTH_PER_SECOND = 0.1`), jusqu'à un point de crash (`crash_point_x100`) tiré au hasard à la création de la manche mais **caché du client jusqu'au crash** (`crashed_at = started_at + ln(crash_point)/GROWTH_PER_SECOND`, calculé dès le passage à `running`).
- Chaque joueur mise pendant `betting`, peut se retirer (`cashout`) à tout moment pendant `running` pour empocher `mise × multiplicateur courant au moment du clic` (capé à `crash_point_x100`, jamais au-delà). S'il ne se retire pas avant le crash, sa mise déjà débitée est perdue.
- `CRASH_RTP_PERCENT = 96` — retour théorique au joueur de 96%, cohérent avec le Tower (même avantage maison, voir 7.3).

#### 7.3 Tower (migration 041)

- Jeu de progression **solo** (façon csgofast, grille de cases par étage) : contrairement au Blackjack/Crash, pas de manche partagée entre joueurs — chaque partie est strictement individuelle, avancée par le joueur lui-même case par case (pas de cron, pas d'état à faire avancer "à la lecture").
- **Même hauteur pour toutes les difficultés** (`TOWER_FLOORS = 8`, décision explicite — la tour ne doit pas paraître plus courte/longue selon la difficulté) ; seuls le nombre de cases/mines par étage changent :
  - `easy` : 3 cases, 1 mine
  - `medium` : 2 cases, 1 mine (50/50, grille à 2 plutôt qu'une simple variante de la grille à 3 — décision explicite)
  - `hard` : 3 cases, 2 mines
- Multiplicateur par étage calculé pour un **RTP fixe de 96%** (`HOUSE_EDGE = 0.04`, même valeur que Crash) : `perLevelMultiplier = (1 - HOUSE_EDGE) / (probabilité de survie de l'étage)`, cumulé étage par étage et arrondi à l'entier (x100) à chaque niveau — l'arrondi entier ajoute une toute petite marge maison supplémentaire, cumulée à chaque étage franchi.
- Seule la **position** de la/des mine(s) par étage est tirée au hasard à la création (`mine_positions`), jamais révélée au client pour un étage tant qu'il n'a pas été franchi ou que la partie n'est pas terminée.
- Une seule partie `in_progress` à la fois par joueur (index unique partiel) — empêche un double `/start` de débiter deux fois la même mise.
- Le joueur peut se retirer (`cash_out`) à tout moment pour empocher `mise × multiplicateur cumulé courant` (arrondi à l'entier inférieur), ou continuer jusqu'à toucher une mine (`busted`, mise perdue) ou atteindre le sommet.

#### Garde-fou économique commun aux quatre jeux :
- Le seul plafond dur est `gambling_max_wager_per_day` : la somme de tous les `gambling_spend` du jour (frontière en heure locale Europe/Paris, même exception délibérée que le bonus quotidien) d'un joueur, **tous jeux confondus** (caisses + Blackjack + Crash + Tower), ne peut pas dépasser cette valeur.
- Le MSP reste libre de configurer les probabilités/montants des caisses (pas de validation automatique d'espérance de gain) — l'UI d'édition de caisse affiche l'**espérance de gain calculée en direct** à titre d'aide à la décision. Blackjack/Crash/Tower ont en revanche un RTP fixe câblé dans le code (respectivement les règles standard du blackjack, 96%, 96%), pas configurable par le MSP.

#### Contraintes MSP (via admin_config) :
- `gambling_enabled`, `blackjack_enabled`, `crash_enabled`, `tower_enabled` : coupe-circuits indépendants
- `gambling_max_wager_per_day` : plafond de mise SP/jour, tous jeux confondus, par joueur

### 8. Abonnements (Ko-fi) — financement des serveurs

L'utilisateur voulait un abonnement donnant accès à une caisse gambling, **sans créer de micro-entreprise** (l'argent sert uniquement à payer les serveurs). Deux plateformes de paiement ont été évaluées et écartées avant Ko-fi :
- **Liberapay** (1er choix) : association à but non lucratif dédiée aux dons récurrents, pas de statut pro requis — mais **pas de webhook** (demande ouverte sur `liberapay/liberapay.com#688` depuis 2017, jamais implémentée) et son seul endpoint public (`/<user>/public.json`) n'expose qu'un compteur agrégé de patrons, pas l'identité d'un paiement individuel. Techniquement impossible à intégrer.
- **Stripe en compte perso** : écarté, exige en principe une activité déclarée pour un usage récurrent (risque de suspension de compte sans statut pro).

**Ko-fi** a été retenu : dons/memberships sans statut pro exigé, et un vrai webhook HTTP (payload JSON, retry automatique tant qu'il ne reçoit pas un 200).

#### Don ponctuel ("one time") vs abonnement récurrent ("monthly") :
- Le widget Ko-fi propose deux modes, tous deux **activent le même statut abonné** pour la même durée (`kofi_subscription_period_days`) — décision explicite de l'utilisateur : un supporter ponctuel n'est pas moins légitime qu'un abonné récurrent. Seule différence : un don ponctuel ne se renouvelle pas tout seul, l'accès expirera à la fin de la période sauf nouveau paiement (ponctuel ou récurrent).
- **Pas de montant minimum vérifié côté app** — décision explicite de l'utilisateur : le prix plancher est configuré directement sur la page Ko-fi (réglages du widget), une seule source de vérité sur le prix plutôt qu'une valeur dupliquée et potentiellement désynchronisée dans l'app. N'importe quel montant sur un type éligible déclenche l'activation.
- Seuls les types `Donation` (don ponctuel) et `Subscription` (abonnement) sont éligibles — `Shop Order`/`Commission` ne comptent jamais, ce n'est pas le même geste de soutien.

#### Lien entre un paiement Ko-fi et un compte SP :
- Chaque joueur a un `link_code` (8 caractères, généré à la première consultation de la section Abonnement de son profil) à coller dans le champ message de son paiement Ko-fi.
- **Piège Ko-fi** : le champ `message` n'est fourni par Ko-fi que sur le tout premier paiement d'un **abonnement récurrent** (`is_first_subscription_payment = true`) — les renouvellements suivants arrivent avec un message vide. Un **don ponctuel**, en revanche, porte toujours son message, qu'il soit le premier ou le centième — pas de restriction "premier paiement" à appliquer dans ce cas. Les renouvellements d'abonnement (message vide) sont donc rattachés automatiquement via l'**email Ko-fi** capturé lors du premier paiement matché (`kofi_email`), pas via le code.
- **Aucun événement d'annulation** n'existe côté Ko-fi (confirmé dans leur doc officielle) : `current_period_end` avance de `kofi_subscription_period_days` (défaut 35, une marge sur le cycle mensuel de 30 jours) à chaque paiement éligible reçu, et l'accès expire de lui-même faute de renouvellement — pas de révocation active en réaction à un événement.
- Si le code collé ne correspond à personne (faute de frappe, code absent) sur un paiement de type éligible → le paiement reste dans `kofi_events` avec `matched_user_id = NULL`, visible dans une file d'attente sur `/admin/abonnements` pour rattachement manuel par le MSP (recherche par nom/email/montant/date). Un `Shop Order`/`Commission` non rattaché n'y apparaît jamais — ce n'est pas une erreur à corriger, ce type n'est simplement jamais éligible.

#### Webhook (`POST /api/subscriptions/kofi-webhook`) :
- Ko-fi POSTe en `application/x-www-form-urlencoded`, un unique champ `data` contenant le JSON de l'événement — parsing dédié (`express.urlencoded`) sur cette seule route, pas globalement.
- Non authentifié par JWT (ce n'est pas un utilisateur de l'app qui appelle) : vérifié via `verification_token` comparé à `KOFI_VERIFICATION_TOKEN` (secret d'infra, `server/.env`, jamais en BDD ni exposé via `admin_config` — même principe que `DISCORD_WEBHOOK_URL`, section 6bis). Tant que cette variable est vide, le webhook refuse tout (503).
- Idempotent sur `kofi_transaction_id` (retry Ko-fi = même transaction id) : un événement déjà vu répond 200 sans retraiter.
- Toujours répondre 200 une fois traité, même si non rattaché — Ko-fi retenterait sinon indéfiniment un paiement qui ne changera pas de statut.

#### Caisse "abonnés" :
- Réutilise entièrement le système de caisses existant (section 7.0) plutôt qu'un système séparé : `gambling_crates.requires_subscription` conditionne l'ouverture à un abonnement actif au lieu d'un coût SP. Une caisse peut cumuler les deux (coût SP **et** réservée aux abonnés), ou être gratuite pour les abonnés (`cost_sp = 0`, ce qui exige toujours `max_opens_per_player` comme n'importe quelle caisse gratuite).
- Une caisse réservée reste **visible** dans la liste (pas masquée comme les caisses archivées) avec un badge « Abonnés » — le bouton d'ouverture est désactivé avec un message renvoyant vers le profil plutôt que la caisse disparaître.
- Vérification de l'abonnement toujours refaite côté serveur dans `openCrate` (jamais une confiance dans le `subscriptionActive` renvoyé au client).

#### Contraintes MSP (via admin_config) :
- `kofi_subscription_period_days` : durée de validité d'un abonnement après un paiement reçu
- Pas de montant minimum configurable côté app — le prix est entièrement géré sur la page Ko-fi elle-même (voir plus haut)

#### Panel MSP (`/admin/abonnements`, page dédiée — pas fusionnée dans une page joueur) :
- Liste de tous les abonnements consultés au moins une fois (statut, date de fin, email Ko-fi, dernier paiement), avec activation/prolongation manuelle (ex : paiement vérifié à l'œil sur le dashboard Ko-fi) et révocation
- File d'attente des paiements Ko-fi non rattachés, avec rattachement manuel à un compte

### 9. Suggestions (features & bugs)

Page (`/suggestions`) où les joueurs proposent des features ou signalent des bugs, votent façon Reddit (upvote **et** downvote) et commentent — accessible depuis le sous-menu du profil (pas dans la barre de nav principale). Pas de page `/admin/suggestions` séparée, les contrôles MSP (clôturer, supprimer) sont directement dans la page de détail, visibles si `user.role === 'admin'` (même pattern que Mini-Jeux/Gambling).

#### Flux :
- N'importe quel joueur crée une suggestion : type (`feature` ou `bug`), titre, description libre optionnelle.
- **Vote** : up **ou** down, un vote par joueur par suggestion (`suggestion_votes.value` = 1 ou -1). Revoter dans le même sens retire le vote (bascule) ; voter dans l'autre sens le remplace. Le score affiché est la somme des votes (peut être négatif). Le tri "Top" trie par score, "Récents" par date de création.
- **Commentaires** : liste plate (pas de réponses imbriquées), un commentaire par soumission, pas de modification/suppression après publication (pas de modération individuelle des commentaires — hors scope, seule la suppression du post entier par le MSP existe).
- Le compteur de votes/commentaires est calculé à la volée (sous-requêtes scalaires, pas de `JOIN` + `GROUP BY` pour éviter le produit cartésien votes×commentaires), pas dénormalisé sur `suggestions`.

#### Actions MSP :
- **Clôturer** (`status = 'closed'`) : la suggestion devient lecture seule (plus de vote ni de commentaire possible, vérifié côté serveur dans les deux contrôleurs, pas seulement caché côté client), reste visible dans l'historique/filtre "Clôturées". Notifie l'auteur (`suggestion_closed`).
- **Supprimer** : suppression **définitive** de la suggestion, de ses votes et commentaires (`ON DELETE CASCADE`) — contrairement au reste de l'app (transactions, défis, comptes joueurs…), il n'y a ici aucun enjeu d'historique économique ou de traçabilité anti-triche à préserver, donc pas de soft-delete. Décision explicite de l'utilisateur ("le MSP peut clôturer ou supprimer des posts").
- Un nouveau commentaire notifie l'auteur du post (`suggestion_comment`), sauf si l'auteur commente son propre post.
- Pas de notification broadcast à la création d'une suggestion (contrairement à l'ouverture d'un mini-jeu) — n'importe quel joueur peut poster à tout moment, contrairement à un mini-jeu (action MSP rare), notifier tout le monde à chaque suggestion serait trop bruyant.

### 10. Cosmétiques (migrations 024–031)

Système de cosmétiques équipables (5 emplacements : `avatar_frame`, `banner`, `name_color`, `title`, `name_font`), purement visuels et sans effet sur l'économie SP — à distinguer des gains `custom` du gambling (collection non-équipable, section 7.0). Page joueur `/cosmetiques` (équiper/déséquiper, vitrine), page MSP dédiée `/admin/cosmetiques` pour gérer le catalogue — **seule exception** au pattern "contrôles MSP fusionnés dans la page joueur" des autres sections (Mini-Jeux/Gambling/Suggestions/Enchères) : la gestion du catalogue (créer/éditer/retirer un cosmétique) est une action strictement MSP, sans équivalent joueur à fusionner.

#### Catalogue & raretés :
- 5 niveaux de rareté : `common` (gris) < `uncommon` (vert, migration 030) < `rare` (bleu) < `epic` (violet) < `legendary` (jaune doré) — couleurs alignées côté client dans `client/src/lib/cosmeticsLabels.ts`.
- Un cosmétique `is_default` par emplacement sert de repli implicite (pas besoin de l'attribuer à chaque joueur) ; jamais supprimable.
- Assets fournis en SVG faits maison, servis depuis `client/public/cosmetics/` (même origine que le client) plutôt que dépendre d'un hébergeur externe ; certains sont animés en SMIL (`frame_arcenciel`, `banner_aurore`).
- `name_font` (migration 026) réutilise une liste fermée de Google Fonts chargées globalement dans `client/index.html`.
- `title` réutilise `color_value` (comme `name_color`) pour se teinter, configurable par le MSP par titre.

#### Obtention & possession :
- Deux sources : caisses gambling (`gambling_crate_rewards.type = 'cosmetic'`) et octroi manuel MSP.
- **Empilable** (migration 031) : un gain en double incrémente `user_cosmetics.quantity` au lieu d'être ignoré. Un joueur peut équiper au plus un exemplaire par emplacement (`equipped`), quelle que soit la quantité possédée.
- **Pool de récompense caisse** (migration 028) : au lieu de toujours pointer un cosmétique précis, une récompense `cosmetic` peut filtrer par `cosmetic_slot_filter` et/ou `cosmetic_rarity_filter` (ex : "n'importe quel Titre Épique", "n'importe quel Cadre toutes raretés"). Le cosmétique concret est tiré à l'ouverture, **pondéré par rareté** (`cosmetic_rarity_weight_common/uncommon/rare/epic/legendary` dans `admin_config`) plutôt qu'uniformément — un légendaire reste plus rare qu'un commun même à l'intérieur d'un même pool.
- Chaque gain cosmétique notifie le joueur (`cosmetic_earned`).

#### Contraintes MSP (via admin_config) :
- `cosmetic_rarity_weight_common` / `_uncommon` / `_rare` / `_epic` / `_legendary` : poids de tirage relatifs à l'intérieur d'un pool de récompense caisse

### 11. Enchères de cosmétiques (migrations 031–033)

Marché entre joueurs (`/encheres`, `/encheres/:id`) pour revendre un exemplaire de cosmétique déjà possédé — fusionné dans la page joueur, contrôles MSP (annulation) visibles si `user.role === 'admin'`, même pattern que Mini-Jeux/Gambling/Suggestions.

#### Flux :
1. Le vendeur met en vente **un seul exemplaire** d'un cosmétique qu'il possède (`quantity > 0`), avec un prix de départ (`starting_price`) et une durée (`auction_min_duration_minutes` à `auction_max_duration_minutes`, défauts 5 à 4320 min — bornes en **minutes**, pas en heures : la migration 033 a remplacé les bornes horaires initiales pour permettre un timer personnalisé plus fin). L'exemplaire est retiré de l'inventaire du vendeur dès la mise en vente.
2. Les joueurs surenchérissent (`POST /:id/bids`) : chaque offre doit dépasser l'offre courante d'au moins `auction_min_bid_increment` SP. Le montant misé est **immédiatement débité** (`auction_bid_hold`) — c'est un dépôt de garantie, pas un engagement sur papier.
3. Une offre dépassée est **remboursée immédiatement** (`auction_bid_refund`, `affects_total_earned = false` pour ne pas gonfler le total gagné d'un simple remboursement) dès qu'une offre supérieure est acceptée — un joueur ne reste jamais bloqué avec des SP immobilisés sur une enchère qu'il ne mène plus.
4. À l'échéance (`ends_at`, résolution paresseuse "à la lecture" comme l'expiration des défis — pas de cron) : s'il y a eu au moins une offre, le plus offrant remporte le cosmétique (transféré dans son `user_cosmetics`) et le vendeur reçoit le montant (`auction_sale`) ; sinon l'enchère passe `expired` sans transaction, le cosmétique retourne au vendeur.
5. Le MSP (**et uniquement le MSP**, pas le vendeur) peut **annuler** une enchère `active` à tout moment (`DELETE /:id`, `requireAdmin`) : le meilleur enchérisseur courant est remboursé (`auction_bid_refund`), l'enchère passe `cancelled`, le cosmétique retourne au vendeur.

#### Notifications :
- `auction_outbid` (surenchéri), `auction_won` (remporté), `auction_sold` (vendu), `auction_expired` (aucune offre), `auction_cancelled` (annulé par le MSP).

#### Contraintes MSP (via admin_config) :
- `auction_min_duration_minutes` / `auction_max_duration_minutes` : bornes de durée à la création
- `auction_min_bid_increment` : surenchère minimale en SP

### 12. Motus (migrations 042–044)

Mot à deviner par jour façon Wordle (`/motus`), un mot **commun à tous les joueurs** par date locale Europe/Paris (même frontière de journée que le bonus quotidien et le budget gambling, `localDate.ts`) — pas de cron, le mot du jour est créé **paresseusement** à la première requête de la journée (même idiome que la ligne `subscriptions`, créée au premier accès), avec `ON CONFLICT (word_date) DO NOTHING` + relecture pour gérer la course entre deux joueurs déclenchant sa création simultanément.

- **Simplification assumée** : mots en lettres A-Z uniquement (pas d'accents), aussi bien dans la file MSP que dans le dictionnaire aléatoire embarqué — évite un clavier virtuel accentué côté client pour un gain de fidélité marginal. (Historique : le dictionnaire embarqué a été restreint au français uniquement après une itération précédente qui mélangeait les langues.)
- **Source du mot du jour** (`motus_daily_words.source`, migration 044) : `'queue'` (consommé dans la file MSP), `'random'` (dictionnaire embarqué, file vide ce jour-là), ou `'manual'` (le MSP a remplacé le mot du jour après coup, avant toute tentative — `motusService.overrideTodayWord`).
- **File de mots MSP** (`motus_word_queue`) : consommée par `position` explicite (réordonnable par le MSP, `motusService.reorderQueueWord`, migration 044) plutôt que strictement par ordre d'ajout. Un mot déjà utilisé (`used_at`) reste en base pour l'historique mais ne peut plus être reconsommé.
- Chaque joueur a droit à `motus_max_attempts` tentatives par jour (défaut 6), chacune verrouillée après soumission (`motus_attempts`, comme `minigame_answers`). Feedback par lettre façon Wordle standard (`correct` / `present` / `absent`, avec gestion des lettres dupliquées).
- Trouver le mot rapporte `motus_reward_sp` SP (transaction `motus_reward`) — un seul gain par joueur par jour, à la première bonne réponse. Pas de notification dédiée : le résultat s'affiche en direct dans la grille du joueur, pas de bruit supplémentaire pour un jeu solo quotidien.
- Pas de polling : partie strictement individuelle, rien à synchroniser avec d'autres joueurs en direct.

#### Contraintes MSP (via admin_config) :
- `motus_reward_sp` : SP gagnés en trouvant le mot du jour
- `motus_max_attempts` : nombre max de tentatives par joueur par jour

---

## Rôles & Permissions

| Action                               | `player` | `admin` (MSP) |
|--------------------------------------|---|---|
| Se connecter, voir le leaderboard    | ✅ | ✅ |
| Créer/accepter des défis             | ✅ | ✅ |
| Participer aux mini-jeux (quiz, Flappy Bird) | ✅ | ✅ |
| Jouer au Blackjack, Crash, Tower, ouvrir des caisses | ✅ | ✅ |
| Équiper des cosmétiques, mettre en vente/enchérir | ✅ | ✅ |
| Jouer au Motus                       | ✅ | ✅ |
| Voir ses transactions                | ✅ | ✅ |
| Créer/clôturer/annuler une session mini-jeu | ❌ | ✅ |
| Attribuer les SP d'un mini-jeu, exclure une tentative Flappy Bird | ❌ | ✅ |
| Créer/configurer une caisse gambling | ❌ | ✅ |
| Activer/désactiver Blackjack, Crash, Tower, les alertes Discord | ❌ | ✅ |
| Gérer le catalogue de cosmétiques (`/admin/cosmetiques`) | ❌ | ✅ |
| Octroyer un cosmétique manuellement  | ❌ | ✅ |
| Annuler une enchère de cosmétique    | ❌ | ✅ |
| Configurer/réordonner la file de mots Motus, forcer le mot du jour | ❌ | ✅ |
| Arbitrer un défi                     | ❌ | ✅ |
| Gérer les saisons                    | ❌ | ✅ |
| Modifier admin_config                | ❌ | ✅ |
| Accorder/retirer des SP manuellement | ❌ | ✅ |
| Révoquer une transaction SP          | ❌ | ✅ |
| Annuler/invalider un défi            | ❌ | ✅ |
| Se rendre invisible du leaderboard   | ❌ | ✅ |
| Désactiver/réactiver un compte joueur | ❌ | ✅ |
| Promouvoir un joueur admin           | ❌ | ✅ |
| Voir tous les logs de transactions   | ❌ | ✅ |
| Activer/prolonger/révoquer un abonnement | ❌ | ✅ |
| Rattacher manuellement un paiement Ko-fi | ❌ | ✅ |
| Proposer une suggestion, voter, commenter | ✅ | ✅ |
| Clôturer/supprimer une suggestion         | ❌ | ✅ |

> Il n'y a **pas de limite** au nombre d'admins. N'importe quel admin peut en promouvoir un autre.

---

## Panel Admin (MSP)

> Trois approches coexistent, par choix explicite : certaines sections MSP ont leur propre route `/admin/...` protégée par `requireAdmin` ; d'autres sont **fusionnées dans les pages joueur partagées**, avec les contrôles MSP affichés uniquement si `user.role === 'admin'` ; les Cosmétiques sont un cas hybride (catalogue en page admin dédiée, équipement en page joueur). Les Mini-Jeux ont été délibérément migrés de "page admin séparée" vers "section MSP dans la page joueur" en cours de projet, à la demande explicite de l'utilisateur — ne pas recréer de page `/admin/mini-jeux` séparée ; même principe pour Gambling, Suggestions et Enchères, qui n'ont jamais eu de page admin séparée.

Sections dans des pages `/admin/...` dédiées :
- **Config** (`/admin/config`) : formulaire pour modifier toutes les clés `admin_config`
- **Saisons** (`/admin/saisons`) : créer, clôturer, consulter les archives
- **Joueurs** (`/admin/joueurs`) : liste de tous les comptes (rôle, solde, statut), désactiver/réactiver un compte (jamais de suppression — voir la note sur `disabled_at` dans le schéma `users` plus haut). Le MSP ne peut pas désactiver son propre compte.
- **Défis** (`/admin/defis`) : liste filtrée (en cours, en attente, contestés), arbitrage (force un gagnant parmi les participants `accepted`), annulation
- **Transactions** (`/admin/transactions`) : log global avec filtres (joueur, type, saison, date), révocation, création manuelle de transaction
- **Abonnements** (`/admin/abonnements`) : liste des abonnements, activation/prolongation/révocation manuelle, file d'attente des paiements Ko-fi non rattachés (section 8) — page dédiée plutôt que fusionnée dans le profil joueur, car ce sont des actions strictement MSP
- **Cosmétiques** (`/admin/cosmetiques`) : créer/éditer/retirer un cosmétique du catalogue, octroi manuel à un joueur — page dédiée car la gestion du catalogue n'a pas d'équivalent joueur à fusionner (contrairement à l'équipement, qui vit sur `/cosmetiques`)

Sections fusionnées dans la page joueur correspondante (visibles seulement si MSP) :
- **Mini-Jeux** (`/mini-jeux`, `/mini-jeux/:id`) : créer une session (quiz ou Flappy Bird), poser/clôturer une question (quiz), configurer les récompenses par rang et exclure une tentative (Flappy Bird), attribuer les SP librement (quiz), clôturer/annuler la session
- **Gambling** (`/gambling`, `/gambling/crates`, `.../blackjack`, `.../crash`, `.../tower`) : créer/éditer des caisses, gérer le pool de récompenses (SP, custom, ou cosmétique — précis ou pool par rareté/emplacement), archiver/désarchiver une caisse, supprimer une caisse jamais ouverte, activer/désactiver Blackjack/Crash/Tower indépendamment des caisses
- **Suggestions** (`/suggestions`, `/suggestions/:id`) : clôturer ou supprimer une suggestion
- **Enchères** (`/encheres`, `/encheres/:id`) : annuler une enchère active (remboursement automatique du meilleur enchérisseur)
- **Motus** (`/motus`) : gérer/réordonner la file de mots, forcer le mot du jour avant toute tentative

---

## Ordre de build recommandé

> Phases 1 à 6 sont **complétées**. Le contenu ci-dessous reste comme trace de la spec initiale ; certains points ont évolué en cours de route (voir notes ⚠️) — se fier aux sections détaillées plus haut, pas à ce plan, en cas de divergence. Plusieurs fonctionnalités majeures ont été ajoutées après la Phase 6 (voir "Fonctionnalités additionnelles" ci-dessous) sans jamais avoir eu de découpage en phases formel — chacune a été livrée comme un ajout ponctuel à la demande de l'utilisateur.

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
  ⚠️ Étendu en cours de projet : plusieurs adversaires au sein d'un même défi (voir section 4), description libre, annulation/invalidation MSP, type "pile ou face" (coin_flip)

Phase 5 — Mini-Jeux (Quiz) ✅
  ⚠️ Pivot complet en cours de projet : quiz en direct (self-join, question live, réponses cachées, SP libres) — remplace la version initiale "MSP saisit un rang, récompenses fixes" (voir section 5.1)
  ⚠️ Étendu en cours de projet : mini-jeu Flappy Bird (game_type distinct, anti-triche par jeton signé, récompenses fixes par rang — voir section 5.2), annulation de session, alerte Discord au lancement

Phase 6 — Polish ✅
  ✅ Notifications in-app (défi reçu/accepté/décliné/résolu/annulé/expiré, mini-jeu ouvert, gain/perte de SP) + synchronisation temps réel par polling
  ✅ Upload avatar
  ✅ Page stats détaillée par joueur
  ✅ Responsive mobile + nav fixe en haut + micro-animations ("juice")

Phase 7 — Gambling étendu, cosmétiques, économie joueur-à-joueur (non planifiée à l'origine, ajoutée au fil de l'eau) ✅
  ✅ Case opening (caisses configurables, pool pondéré SP/custom) puis abonnement Ko-fi (caisse réservée)
  ✅ Blackjack multijoueur tour par tour, puis Crash, puis Tower — chacun avec son propre coupe-circuit
  ✅ Cosmétiques équipables (5 emplacements, 5 raretés, obtenables via caisses ou octroi MSP), gains caisse "pool" par rareté/emplacement
  ✅ Enchères de cosmétiques entre joueurs (marché secondaire, résolution paresseuse comme les défis)
  ✅ Suggestions (features/bugs, vote up/down, commentaires)
  ✅ Motus (mot du jour partagé, file MSP configurable)
```

### Fonctionnalités additionnelles (hors spec initiale)

Ajoutées en cours de projet, à la demande de l'utilisateur, non prévues dans le plan ci-dessus :
- Révocation d'une transaction SP par le MSP (jamais de suppression, ajustement inverse tracé)
- Visibilité du MSP dans le leaderboard (`is_leaderboard_hidden`)
- Transactions classées par saison dans la page transactions ; interdiction de révoquer une transaction d'une saison archivée
- Le MSP peut créer une transaction SP manuelle directement (pas seulement ajuster un solde) ; possibilité de marquer une transaction manuelle comme n'affectant pas `sp_total_earned` (corrections/prêts sans fausser le classement par total gagné)
- Popups de confirmation custom (`useConfirm`) à la place de `window.confirm` natif
- Tags visuels du type de mini-jeu dans la liste des mini-jeux
- Abonnement mensuel via Ko-fi (financement des serveurs) avec caisse gambling réservée aux abonnés (voir section 8)
- Page Suggestions : proposition de features/bugs par les joueurs, vote façon Reddit (up/down), commentaires, clôture/suppression par le MSP (voir section 9)
- Défis "Pile ou face" (`challenges.type = 'coin_flip'`) : variante 1v1 des défis SP Wager où l'adversaire choisit son côté et le gagnant est tiré au sort par le serveur dès l'acceptation, sans déclaration manuelle ni arbitrage nécessaire (voir section 4)
- Mini-jeu Flappy Bird : jeu solo embarqué, anti-triche par jeton signé point par point, récompenses fixes par rang, annulation de session sans distribution (voir section 5.2)
- Alerte Discord (webhook sortant) au lancement d'un mini-jeu, activable/désactivable par le MSP, secret d'infra jamais exposé en BDD (voir section 6bis)
- Blackjack multijoueur tour par tour, Crash et Tower : trois jeux d'argent virtuel supplémentaires partageant le budget quotidien des caisses mais avec leurs propres coupe-circuits (voir section 7)
- Cosmétiques équipables (cadres, bannières, couleur/police de pseudo, titres), empilables, obtenables via caisses (précis ou "pool" par rareté/emplacement) ou octroi MSP (voir section 10)
- Enchères de cosmétiques entre joueurs, marché secondaire avec résolution paresseuse et annulation MSP (voir section 11)
- Motus quotidien partagé entre tous les joueurs, file de mots configurable et réordonnable par le MSP (voir section 12)

---

## Conventions de code

- **Langue** : code et commentaires en anglais, UI en français
- **SP** toujours en entier (INT), jamais de décimales — y compris les multiplicateurs de jeu (Crash, Tower), stockés en `INT` ×100 plutôt qu'en `NUMERIC`, pour éviter le parsing en chaîne que `pg` applique par défaut aux colonnes `NUMERIC`
- Toutes les mutations de solde SP passent par une fonction centrale :
  ```ts
  // server/src/services/sp.service.ts
  await creditSP({ userId, amount, type, seasonId, relatedId, note, affectsTotalEarned, client })
  await debitSP({ userId, amount, type, seasonId, relatedId, note, affectsTotalEarned, client })
  // Ces fonctions vérifient le solde, effectuent la mutation, et insèrent la transaction
  // Jamais de UPDATE sp_balance direct en dehors de ce service
  // `affectsTotalEarned` (optionnel, défaut true) : si false, seul sp_balance bouge, pas sp_total_earned
  // (ex : remboursement d'enchère annulée, transaction manuelle MSP marquée "prêt"/correction)
  // `client` (PoolClient) est optionnel : à passer pour composer l'appel dans une transaction
  // déjà ouverte par l'appelant (ex : résolution de défi à N participants, bonus de connexion
  // avec verrou de ligne, résolution Blackjack/Crash/Tower) — sinon la fonction ouvre et commit sa propre transaction.
  ```
- Interdiction formelle d'avoir `sp_balance < 0` — vérification en amont ET contrainte CHECK en BDD :
  ```sql
  ALTER TABLE users ADD CONSTRAINT sp_balance_non_negative CHECK (sp_balance >= 0);
  ```
- Les valeurs `admin_config` sont relues depuis la BDD à chaque requête sensible (pas de cache)
- Tous les timestamps en **UTC**, sauf les frontières de journée du bonus quotidien (section 3), du budget gambling journalier/reset de caisse (section 7), et du mot du jour Motus (section 12), qui utilisent l'heure locale Europe/Paris (`server/src/utils/localDate.ts`) — exception délibérée, pas un oubli
- Les dates de connexion comparées en date locale Europe/Paris (pas datetime) pour le bonus quotidien
- Les jeux "à manche partagée" sans cron (Blackjack, Crash, expiration des défis 24h, résolution d'enchère) suivent tous le même idiome : l'état avance **"à la lecture"**, c'est-à-dire que chaque requête qui touche la ressource vérifie d'abord si un délai est dépassé et fait progresser l'état avant de répondre — jamais de job planifié dans ce projet
- Les secrets d'infra qui donnent un pouvoir d'action externe (webhook Discord, token de vérification Ko-fi) vivent exclusivement dans `server/.env`, jamais dans `admin_config` (éditable en clair depuis le panel MSP) — seul un booléen d'activation y est exposé
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
# Requis pour activer l'abonnement Ko-fi (section 8) — "Verification Token" sur
# https://ko-fi.com/manage/webhooks. Vide = webhook désactivé (503).
KOFI_VERIFICATION_TOKEN=
# Requis pour activer l'alerte Discord au lancement d'un mini-jeu (section 6bis).
# Vide = alerte silencieusement désactivée, quelle que soit la valeur de discord_notifications_enabled.
DISCORD_WEBHOOK_URL=
# Optionnel — ID du rôle Discord à taguer (<@&ID>) dans l'alerte.
DISCORD_ALERT_ROLE_ID=
# Origine publique du client, utilisée pour construire le lien cliquable dans l'alerte Discord.
CLIENT_ORIGIN=

# client/.env
VITE_API_URL=http://localhost:3001
# URL de la page Ko-fi du MSP (ex: https://ko-fi.com/tonpseudo), affichée sur le profil.
VITE_KOFI_URL=
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
| Récompenses mini-jeu (quiz) | ~~Montants fixes~~ → **montant libre choisi par le MSP par joueur** (pivot vers le quiz en direct). Flappy Bird, ajouté plus tard, réintroduit des récompenses fixes par rang — les deux mécanismes cohabitent selon le `game_type` |
| Saisons | Oui — classements et stats par saison, archives consultables            |
| Un défi peut-il avoir plusieurs adversaires ? | Oui — **au sein d'un même défi** (un pot commun, un gagnant), pas plusieurs défis séparés. Correction explicite de l'utilisateur après une première implémentation erronée en "N défis 1v1 indépendants". |
| Mise en cas de N adversaires ? | Chacun mise le même montant ; le gagnant remporte le pot entier (`wager × participants accepted`) — généralisation stricte du 1v1 |
| Tout le monde doit-il accepter avant que le défi démarre ? | Non — dès que les réponses sont toutes connues (ou le délai de 24h expiré), le défi démarre s'il reste ≥ 2 acceptants ; les refus individuels n'annulent pas les autres |
| Synchronisation temps réel ? | Polling à intervalles courts par écran (pas de WebSocket) — voir section 6, intervalles très variables selon la vitesse du jeu (300ms pour un Crash `running`, aucun polling pour les parties strictement solo comme Motus/Tower) |
| Le MSP peut-il être caché du classement ? | Oui — `is_leaderboard_hidden`, n'affecte que les classements, pas le profil/les transactions |
| Le MSP peut-il révoquer une transaction ? | Oui, sauf si sa saison est archivée (`closed`) — jamais de suppression, toujours un ajustement inverse tracé |
| Le MSP peut-il supprimer un compte joueur ? | Non, seulement le **désactiver** (`disabled_at`) — décision explicite de l'utilisateur pour préserver l'historique (transactions, défis, season_snapshots), même principe que `is_leaderboard_hidden`. Bloque login/refresh, masque du leaderboard et de la sélection d'adversaire. Réversible, et un MSP ne peut pas se désactiver lui-même |
| Architecture des pages admin ? | Mixte : pages `/admin/...` dédiées pour Config/Saisons/Joueurs/Défis/Transactions/Abonnements/Cosmétiques (catalogue), mais Mini-Jeux, Gambling, Suggestions et Enchères sont fusionnés dans la page joueur (contrôles visibles si MSP) — décision explicite de l'utilisateur, ne pas re-séparer |
| Type de gambling au lancement ? | Case opening d'abord, puis étendu (à la demande de l'utilisateur, sans plan initial) à Blackjack, Crash et Tower — chacun avec son propre coupe-circuit indépendant, tous partageant le même plafond de mise quotidien |
| Les gains "custom" (image+titre) ont-ils une valeur SP ? | **Non** — purement cosmétiques, aucun effet sur l'économie SP, juste une collection affichée sur le profil (`gambling_inventory`). Distinct des cosmétiques équipables (`type='cosmetic'`), ajoutés plus tard, qui eux s'équipent (section 10) |
| Plafond anti-abus du gambling ? | Un seul levier : `gambling_max_wager_per_day` (SP misé/jour, tous jeux gambling confondus — caisses, Blackjack, Crash, Tower) — pas de plafond séparé sur le nombre d'ouvertures/parties, décision explicite de garder un seul paramètre simple |
| Le MSP doit-il respecter une espérance de gain négative imposée par le système ? | Pour les caisses : non, configuration totalement libre, mais l'UI affiche l'espérance de gain calculée en direct pour aider à la décision. Blackjack/Crash/Tower ont en revanche un RTP fixe câblé dans le code (96% pour Crash/Tower, règles standard pour Blackjack), non configurable |
| Comment encaisser l'abonnement sans micro-entreprise ? | **Ko-fi** (dons/memberships) — Liberapay écarté faute de webhook exploitable (voir section 8), Stripe perso écarté car risqué sans statut pro déclaré |
| Un don ponctuel Ko-fi donne-t-il les mêmes avantages qu'un abonnement récurrent ? | **Oui** — décision explicite de l'utilisateur : "one time" et "monthly" activent tous les deux le même statut abonné pour la même durée. Seule différence : un don ponctuel ne se renouvelle pas tout seul |
| Le prix minimum est-il vérifié côté app ? | **Non** — décision explicite de l'utilisateur : le prix plancher est configuré uniquement sur la page Ko-fi elle-même, pas dupliqué en BDD/config app, pour n'avoir qu'une seule source de vérité sur le prix |
| Comment savoir quel joueur a payé sur Ko-fi ? | Code de liaison collé dans le message du paiement. Un don ponctuel porte toujours son message ; un abonnement récurrent ne le fournit que sur le 1er paiement, les renouvellements sont donc rattachés via l'email Ko-fi capturé au 1er paiement matché. Rattachement manuel MSP en secours (`/admin/abonnements`) si le code est absent/erroné |
| Que se passe-t-il si un abonné annule sur Ko-fi ? | Rien côté webhook — Ko-fi ne notifie pas les annulations. L'accès expire de lui-même à `current_period_end` (paiement + `kofi_subscription_period_days`) faute de renouvellement |
| La caisse "abonnés" est-elle un système séparé du gambling existant ? | Non — un simple flag `gambling_crates.requires_subscription`, réutilise entièrement le pool de récompenses et le tirage pondéré existants (décision explicite de l'utilisateur) |
| Le MSP peut-il supprimer une suggestion (contrairement aux autres ressources de l'app) ? | Oui, suppression définitive (cascade sur votes/commentaires) — décision explicite de l'utilisateur. Contrairement aux transactions/comptes/défis, aucun enjeu d'historique économique ou anti-triche à préserver ici |
| Le vote sur une suggestion est-il façon Reddit (up/down) ? | Oui — up et down, un vote par joueur par suggestion, en bascule ; le score peut être négatif. Décision explicite de l'utilisateur (demande initiale d'upvote seul, étendue au downvote) |
| Un défi "pile ou face" peut-il avoir plusieurs adversaires comme un défi classique ? | Non — restreint à un seul adversaire (2 participants), un pile ou face n'a que deux faces. Résolution automatique par le serveur dès acceptation, pas de déclaration manuelle ni d'étape "accepted" visible |
| Qui choisit le côté (pile/face) dans un défi coin_flip ? | **Le joueur défié**, jamais le challenger — décision explicite de l'utilisateur, le choix appartient à celui qui subit le défi. Le challenger hérite automatiquement du côté opposé |
| Comment empêcher un joueur de forger un score Flappy Bird élevé ? | Jeton JWT signé côté serveur qui n'avance que d'un point authentifié à la fois (`reportPoint`), avec un délai minimum réel vérifié entre deux points — le score soumis final n'est jamais un champ fourni par le client, seulement ce que le jeton porte |
| La tour (Tower) doit-elle être plus courte en facile qu'en difficile ? | Non — même hauteur (8 étages) pour toutes les difficultés, décision explicite de l'utilisateur ; seuls le nombre de cases/mines par étage (et donc le multiplicateur) changent |
| Un cosmétique obtenu en double est-il perdu ? | Non — empilable (`quantity`), incrémenté à chaque gain supplémentaire plutôt qu'ignoré, pour permettre de revendre les doublons en enchère |
| Qui peut annuler une enchère de cosmétique ? | Le **MSP uniquement**, jamais le vendeur — remboursement automatique du meilleur enchérisseur courant s'il y en a un |
| Le mot du Motus peut-il contenir des accents ? | Non — lettres A-Z uniquement, décision explicite pour éviter un clavier virtuel accentué côté client, contrainte appliquée aussi bien à la file MSP qu'au dictionnaire aléatoire (limité au français) |
| Où vivent les secrets comme le webhook Discord ou le token Ko-fi ? | Exclusivement dans `server/.env`, jamais dans `admin_config` — un secret qui donne un pouvoir d'action externe (poster sur Discord, valider un paiement) n'a pas sa place dans une table éditable en clair depuis le panel MSP ; seul un booléen d'activation y est exposé |
