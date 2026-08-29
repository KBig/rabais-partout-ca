-- VARIANTES D'UN MEME ARTICLE.
--
-- Un bracelet de montre existe en 69 couleurs, chacune avec son propre
-- identifiant marchand. Une page de rayon affichait donc 69 cartes
-- pratiquement identiques, au meme prix, et repoussait tout le reste hors
-- ecran. Mesure : 7 264 groupes de ce type.
--
-- `variant_key` regroupe ce qui est le meme article aux yeux d'un acheteur :
-- meme magasin, meme titre une fois retiree la mention d'etat. Le calcul des
-- scores designe ensuite UN representant par groupe — le mieux note — et les
-- listes n'affichent que lui. Les autres restent accessibles et cherchables :
-- ils sont caches du classement, pas supprimes.
ALTER TABLE products ADD COLUMN variant_key TEXT;

CREATE INDEX IF NOT EXISTS idx_products_variant
  ON products (store_id, variant_key);

-- Denormalise dans deal_scores : les listes filtrent dessus, et une jointure
-- vers products annulerait le benefice de l'index de classement.
ALTER TABLE deal_scores ADD COLUMN is_variant_lead INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_scores_lead
  ON deal_scores (is_active, is_variant_lead, score DESC);
