-- Resserre les valeurs par défaut de configuration MSP (economie plus stricte).
UPDATE admin_config SET value = '5' WHERE key = 'login_bonus_base';
UPDATE admin_config SET value = '2' WHERE key = 'max_challenges_per_day';
UPDATE admin_config SET value = '10' WHERE key = 'max_wager_amount';
UPDATE admin_config SET value = '30' WHERE key = 'streak_bonus_max';
UPDATE admin_config SET value = '3' WHERE key = 'streak_required_days';
