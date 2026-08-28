-- Index de classement : le catalogue depasse 200 000 produits.
--
-- LE PROBLEME MESURE
-- Le plan d'execution de la page d'accueil affichait
-- « USE TEMP B-TREE FOR ORDER BY » : SQLite parcourait 163 000 produits, les
-- joignait a leurs scores, puis triait TOUT en memoire pour n'en garder 30.
-- Chaque requete coutait 220-330 ms, et la page d'accueil en enchaine cinq :
-- plus d'une seconde avant le premier octet.
--
-- LA CAUSE
-- Le tri porte sur deal_scores.score, mais les filtres (is_active, condition,
-- categorie) vivent sur products. SQLite ne peut donc pas se servir de l'index
-- de score : il doit d'abord joindre, puis trier.
--
-- LA CORRECTION
-- On recopie les colonnes de filtrage dans deal_scores. Le chemin critique ne
-- touche plus qu'UNE table et UN index, tri compris. C'est une denormalisation
-- assumee : ces valeurs sont reecrites a chaque passage du moteur de score,
-- donc elles ne peuvent pas deriver.

ALTER TABLE deal_scores ADD COLUMN is_active     INTEGER NOT NULL DEFAULT 1;
ALTER TABLE deal_scores ADD COLUMN condition     TEXT    NOT NULL DEFAULT 'new';
ALTER TABLE deal_scores ADD COLUMN category_slug TEXT;
ALTER TABLE deal_scores ADD COLUMN store_id      TEXT;
ALTER TABLE deal_scores ADD COLUMN price         REAL;

-- Classement general (accueil, recherche triee par score).
CREATE INDEX idx_ds_rank_active
  ON deal_scores(is_active, condition, score DESC);

-- Classement par rayon : le prefixe couvre aussi la requete precedente.
CREATE INDEX idx_ds_rank_category
  ON deal_scores(is_active, condition, category_slug, score DESC);

-- Tris secondaires proposes par l'interface.
CREATE INDEX idx_ds_price
  ON deal_scores(is_active, condition, category_slug, price);
CREATE INDEX idx_ds_drop
  ON deal_scores(is_active, condition, category_slug, drop_vs_median DESC);

-- Remplissage initial : les lignes existantes n'ont pas encore ces valeurs.
UPDATE deal_scores
   SET is_active     = (SELECT p.is_active     FROM products p WHERE p.id = deal_scores.product_id),
       condition     = (SELECT p.condition     FROM products p WHERE p.id = deal_scores.product_id),
       category_slug = (SELECT p.category_slug FROM products p WHERE p.id = deal_scores.product_id),
       store_id      = (SELECT p.store_id      FROM products p WHERE p.id = deal_scores.product_id),
       price         = (SELECT p.current_price FROM products p WHERE p.id = deal_scores.product_id);
