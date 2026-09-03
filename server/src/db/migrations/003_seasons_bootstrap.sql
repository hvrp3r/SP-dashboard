-- Une seule saison active à la fois (invariant applicatif + garde-fou en BDD)
CREATE UNIQUE INDEX idx_seasons_one_active ON seasons (status) WHERE status = 'active';

-- Saison initiale, pour que le leaderboard ne soit jamais vide sur une base fraîche
INSERT INTO seasons (name, starts_at, status)
SELECT 'Saison 1', NOW(), 'active'
WHERE NOT EXISTS (SELECT 1 FROM seasons);
