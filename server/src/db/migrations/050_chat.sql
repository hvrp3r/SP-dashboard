-- Chat en direct : un salon 'global' (partout dans l'app) + un salon par jeu
-- casino ('crates' | 'blackjack' | 'crash' | 'tower', room_key vide comme
-- gambling_spectators — jeux singleton partagés par tous) + un salon 'minigame'
-- par session de mini-jeu (room_key = id de la session, vu que les sessions
-- sont créées à la volée par le MSP plutôt que d'être des jeux fixes).
CREATE TABLE chat_messages (
  id SERIAL PRIMARY KEY,
  room VARCHAR(20) NOT NULL,
  room_key VARCHAR(50) NOT NULL DEFAULT '',
  user_id INT NOT NULL REFERENCES users(id),
  body VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_room ON chat_messages (room, room_key, created_at);
