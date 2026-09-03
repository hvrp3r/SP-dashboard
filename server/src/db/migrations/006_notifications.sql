CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT notification_type_valid CHECK (type IN (
    'challenge_received', 'challenge_accepted', 'challenge_declined',
    'challenge_resolved', 'minigame_open'
  ))
);

CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);
