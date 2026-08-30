-- COMPTER SANS OUVRIR LA TABLE.
--
-- L'arbre des categories — « combien d'articles dans chaque rayon, et quel est
-- le meilleur score de chacun » — apparait sur l'accueil, sur chaque page de
-- rayon et sur chaque page de magasin. Il coutait 355 ms, payes trois fois par
-- visite.
--
-- Le plan d'execution disait pourquoi :
--
--   SEARCH deal_scores USING INDEX idx_ds_cat_quality (is_active=? AND category_slug>?)
--
-- Cet index porte (is_active, category_slug, quality_score). Il sait donc
-- COMPTER les lignes d'un rayon sans effort, mais pas en donner le meilleur
-- SCORE : cette colonne n'y figure pas. SQLite parcourait l'index puis allait
-- lire la table pour chacune des 374 000 lignes, une par une.
--
-- L'index ci-dessous porte les deux colonnes dont la requete a besoin. Elle
-- devient alors « couverte » : la reponse se lit entierement dans l'index, sans
-- jamais toucher la table.
--
-- Meme raisonnement pour le comptage par magasin, affiche sur la page
-- « Magasins » et dans l'en-tete de chaque enseigne.
CREATE INDEX IF NOT EXISTS idx_ds_cat_score
  ON deal_scores (is_active, category_slug, score);

CREATE INDEX IF NOT EXISTS idx_products_store_actif
  ON products (is_active, store_id);

-- Les statistiques guident le choix d'index. Sans elles, SQLite decide au
-- jugé — et se trompe d'autant plus que le catalogue grossit.
ANALYZE;
