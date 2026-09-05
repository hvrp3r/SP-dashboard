-- Pile ou face : c'est le joueur défié (jamais le challenger) qui choisit son
-- côté au moment d'accepter — décision explicite de l'utilisateur, le choix
-- appartient à celui qui subit le défi. Le challenger hérite automatiquement
-- du côté opposé dès que l'adversaire a choisi (voir respondToChallenge).
-- Nullable et sans CHECK : uniquement renseigné pour challenges.type = 'coin_flip'.
ALTER TABLE challenge_participants ADD COLUMN coin_side VARCHAR(10);
