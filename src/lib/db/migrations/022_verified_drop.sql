-- LA BAISSE QUE NOUS POUVONS DEFENDRE.
--
-- Le tri « plus forte baisse » s'appuyait sur `drop_vs_median`, mesure dans le
-- TEMPS. Or l'historique a quelques heures : 872 produits sur 282 065 en
-- avaient une superieure a 3 %. Au-dela, le tri classait du bruit — un ecart
-- d'un dollar suffisait a placer un produit devant tous les autres.
--
-- Le systeme dispose pourtant d'une seconde mesure, celle qu'il affiche deja
-- sur chaque carte : « 37 % sous la mediane de 361 produits equivalents ».
-- Elle est mesuree par nous, dans l'ESPACE au lieu du temps, et disponible des
-- la premiere collecte. 100 000 produits en ont une superieure a 5 %.
--
-- Cette colonne retient la meilleure des deux. Elle exclut toujours le rabais
-- ANNONCE par le marchand : trier sur une promesse invérifiable reviendrait a
-- classer en tete ceux qui exagerent le plus.
ALTER TABLE deal_scores ADD COLUMN verified_drop REAL NOT NULL DEFAULT 0;

-- Le tri doit passer par un index, sinon SQLite trie 282 000 lignes en memoire
-- a chaque page (« USE TEMP B-TREE FOR ORDER BY », mesure a 330 ms).
CREATE INDEX IF NOT EXISTS idx_scores_verified_drop
  ON deal_scores (is_active, verified_drop DESC, score DESC);
