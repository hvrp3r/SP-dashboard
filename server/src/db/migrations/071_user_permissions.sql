-- Permissions déléguées par le MSP à un joueur, sans en faire un admin.
-- Une ligne = une permission accordée ; la révoquer supprime la ligne (aucun
-- enjeu d'historique économique ici, contrairement aux transactions — même
-- logique que les suggestions). Pas de CHECK sur `permission` : la liste des
-- valeurs connues vit dans USER_PERMISSIONS (server/src/types.ts), même
-- logique que event_sessions.game_type.
--
-- 'event_organizer' : peut créer des sessions d'événement (quiz, flappy bird,
-- speedrun, tournoi) et gérer uniquement celles qu'il a créées.
CREATE TABLE user_permissions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  permission VARCHAR(50) NOT NULL,
  granted_by INT REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, permission)
);
