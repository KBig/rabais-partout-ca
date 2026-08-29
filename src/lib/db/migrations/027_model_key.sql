-- CLE DE MODELE NORMALISEE, STOCKEE ET INDEXEE.
--
-- Le rapprochement entre magasins comparait
-- `REPLACE(REPLACE(UPPER(model),'-',''),' ','')` des deux cotes. Une expression
-- de ce genre ne peut utiliser aucun index : chaque fiche produit declenchait
-- un balayage complet pour repondre a « combien ailleurs ? ». Mesure : 75 ms
-- par affichage, sur une page qui doit etre instantanee.
--
-- La colonne est calculee a l'ingestion et par la passe de coherence, comme
-- `variant_key`.
ALTER TABLE products ADD COLUMN model_key TEXT;

CREATE INDEX IF NOT EXISTS idx_products_model_key
  ON products (model_key, store_id);

UPDATE products
   SET model_key = UPPER(REPLACE(REPLACE(REPLACE(model, '-', ''), ' ', ''), '.', ''))
 WHERE model IS NOT NULL AND model <> '';
