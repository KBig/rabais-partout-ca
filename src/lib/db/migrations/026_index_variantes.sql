-- REPARER LES INDEX CASSES PAR LE FILTRE DE VARIANTES.
--
-- Le regroupement des variantes a ajoute `is_variant_lead = 1` a toutes les
-- listes. SQLite s'est alors mis a preferer l'index (is_active,
-- is_variant_lead, score) — qui ne contient PAS la categorie. Il parcourait
-- donc 260 000 lignes avant de filtrer le rayon en memoire.
--
-- Mesure : facettes a 2 522 ms, classement de categorie a 1 406 ms, compteur
-- de pagination a 455 ms. Pres de trois secondes de base de donnees pour une
-- seule page de rayon.
--
-- Les bons index existaient deja. Il fallait simplement y faire entrer la
-- nouvelle colonne, en tete, puisqu'elle vaut 1 pour la quasi-totalite des
-- lignes et sert de prefixe constant.

-- Liste et compteur d'un rayon, par score.
CREATE INDEX IF NOT EXISTS idx_ds_lead_cat_score
  ON deal_scores (is_active, is_variant_lead, condition, category_slug, score DESC);

-- Meme rayon, tri par prix.
CREATE INDEX IF NOT EXISTS idx_ds_lead_cat_price
  ON deal_scores (is_active, is_variant_lead, condition, category_slug, price);

-- Meme rayon, tri par baisse verifiee.
CREATE INDEX IF NOT EXISTS idx_ds_lead_cat_drop
  ON deal_scores (is_active, is_variant_lead, condition, category_slug, verified_drop DESC);

-- Page d'une enseigne.
CREATE INDEX IF NOT EXISTS idx_ds_lead_store_score
  ON deal_scores (is_active, is_variant_lead, condition, store_id, score DESC);

-- Comptage par rayon pour l'arbre des categories : l'index couvre le GROUP BY,
-- ce qui evite le tri temporaire en memoire.
CREATE INDEX IF NOT EXISTS idx_ds_cat_count
  ON deal_scores (is_active, category_slug, store_id);

-- Classement par qualite dans un rayon : trois requetes de la fiche produit
-- passaient chacune par un balayage complet.
CREATE INDEX IF NOT EXISTS idx_ds_cat_quality
  ON deal_scores (is_active, category_slug, quality_score DESC);

-- Le planificateur de SQLite choisit son index d'apres des STATISTIQUES. Sans
-- elles, il devine — et devine mal des que la table grossit. On les calcule.
ANALYZE;
