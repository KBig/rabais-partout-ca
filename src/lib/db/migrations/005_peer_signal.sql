-- Signal de comparaison par pairs.
--
-- Le moteur d'historique repond a « moins cher qu'AVANT ? ». Il est excellent,
-- mais muet le premier jour, et l'historique passe n'est pas reconstituable.
--
-- Ce signal repond a « moins cher que ses EQUIVALENTS, maintenant ? ». Il est
-- disponible des le premier crawl. Les deux sont independants : quand l'un
-- manque, l'autre porte le score. C'est ce qui evite un point de defaillance
-- unique dans l'evaluation.

ALTER TABLE deal_scores ADD COLUMN peer_percentile REAL;   -- 0 = le moins cher du groupe
ALTER TABLE deal_scores ADD COLUMN peer_below_median REAL; -- ecart relatif a la mediane du groupe
ALTER TABLE deal_scores ADD COLUMN peer_size INTEGER;      -- taille du groupe compare
ALTER TABLE deal_scores ADD COLUMN peer_median REAL;
