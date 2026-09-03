-- Nouveaux types de notification : annulation/expiration de défi, gains et
-- pertes de SP (mini-jeu, ajustement manuel MSP, révocation de transaction).
ALTER TABLE notifications DROP CONSTRAINT notification_type_valid;
ALTER TABLE notifications ADD CONSTRAINT notification_type_valid CHECK (type IN (
  'challenge_received', 'challenge_accepted', 'challenge_declined',
  'challenge_resolved', 'challenge_cancelled', 'challenge_expired',
  'minigame_open', 'sp_gained', 'sp_lost'
));
