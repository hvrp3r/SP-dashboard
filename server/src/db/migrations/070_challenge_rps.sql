-- Pierre-feuille-ciseaux (challenges.type = 'rps') : 1v1 comme le pile ou face.
-- Les coups ne sont choisis qu'une fois le défi accepté par les deux ; partie en
-- 3 manches (premier à 2 manches gagnées), une égalité se rejoue.
--
-- rps_move : coup de la manche en cours, caché aux autres joueurs tant que la
-- manche n'est pas jouée (masqué côté contrôleur). Remis à NULL après chaque
-- manche. Nullable et sans CHECK, même logique que coin_side.
ALTER TABLE challenge_participants ADD COLUMN rps_move VARCHAR(10);

-- Historique des manches jouées : [{ "moves": { "<user_id>": "rock" | "paper" | "scissors" }, "winner_id": int | null }]
ALTER TABLE challenges ADD COLUMN rps_rounds JSONB NOT NULL DEFAULT '[]'::jsonb;
