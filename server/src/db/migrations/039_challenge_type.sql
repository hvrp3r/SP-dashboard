-- Type de défi : 'custom' (comportement historique — déclaration manuelle du
-- résultat par les participants, consensus ou arbitrage MSP) ou 'coin_flip'
-- (pile ou face — dès que l'unique adversaire invité accepte, le serveur tire
-- un gagnant au hasard et résout le défi immédiatement, pas de déclaration
-- manuelle possible). Pas de CHECK, même choix que minigame_sessions.game_type
-- (migration 034) : validation côté app pour pouvoir ajouter facilement
-- d'autres types de défi plus tard.
ALTER TABLE challenges ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'custom';
