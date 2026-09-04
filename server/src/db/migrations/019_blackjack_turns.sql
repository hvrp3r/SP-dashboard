-- Passage du blackjack multijoueur d'un modèle "mains indépendantes jouées en
-- parallèle" à un vrai tour par tour : une seule main peut agir à la fois.
-- current_hand_id pointe la main dont c'est le tour ; NULL = personne à faire
-- jouer (avant distribution, ou manche prête à être résolue).
ALTER TABLE blackjack_sessions ADD COLUMN current_hand_id INT REFERENCES blackjack_hands(id);
