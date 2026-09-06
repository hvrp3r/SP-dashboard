-- Liste des spectateurs en direct sur les pages de jeux de gambling (caisses,
-- blackjack, crash, tower) : chaque page envoie un heartbeat périodique tant
-- qu'elle reste ouverte (voir useSpectators.ts côté client), et la ligne
-- correspondante est considérée "active" tant que last_seen_at est récent —
-- pas de suppression explicite à la fermeture de l'onglet (pas de beacon
-- fiable sur un simple polling), le TTL applicatif suffit.
-- room_key distingue les caisses entre elles (une caisse = une room_key =
-- son id) ; les jeux singleton (blackjack/crash/tower, une seule table
-- partagée par tous) utilisent room_key = ''.
CREATE TABLE gambling_spectators (
  id SERIAL PRIMARY KEY,
  room VARCHAR(20) NOT NULL,
  room_key VARCHAR(50) NOT NULL DEFAULT '',
  user_id INT NOT NULL REFERENCES users(id),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room, room_key, user_id)
);

CREATE INDEX idx_gambling_spectators_lookup ON gambling_spectators (room, room_key, last_seen_at);
