-- Valeurs par défaut de configuration MSP

INSERT INTO admin_config (key, value, description) VALUES
  ('max_wager_amount', '100', 'Mise maximale par défi'),
  ('max_challenges_per_day', '5', 'Nombre max de défis lancés par joueur par jour'),
  ('login_bonus_base', '10', 'Bonus SP de base pour la connexion quotidienne'),
  ('streak_bonus_step', '2', 'Bonus SP par palier de streak'),
  ('streak_bonus_max', '20', 'Plafond du bonus de streak'),
  ('streak_required_days', '7', 'Nombre de jours consécutifs requis par palier'),
  ('minigame_reward_1st', '50', 'Récompense SP pour la 1ère place'),
  ('minigame_reward_2nd', '30', 'Récompense SP pour la 2ème place'),
  ('minigame_reward_3rd', '15', 'Récompense SP pour la 3ème place')
ON CONFLICT (key) DO NOTHING;
