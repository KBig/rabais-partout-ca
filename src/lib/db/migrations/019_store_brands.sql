-- CATALOGUE DES MARQUES D'UN MAGASIN.
--
-- Le listing Best Buy ne renvoie pas la marque : sur 279 603 produits, elle
-- etait connue pour 894 (0,3 %). Sans marque, impossible d'aller chercher le
-- prix officiel du fabricant — la marque est la premiere moitie de la cle.
--
-- Le marchand publie pourtant ses marques : une page par marque dans son
-- sitemap, et un filtre `brandName` sur son API de recherche. On garde ici le
-- resultat de la decouverte, pour ne pas la refaire a chaque passe et pour
-- pouvoir repondre a « combien de fournisseurs le systeme connait-il ».
CREATE TABLE IF NOT EXISTS store_brands (
  store_id      TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,          -- tel qu'il apparait dans le sitemap
  facet         TEXT,                   -- valeur qui fait REELLEMENT filtrer l'API
  product_count INTEGER,                -- total annonce par le marchand
  labelled      INTEGER NOT NULL DEFAULT 0, -- produits que nous avons pu etiqueter
  checked_at    TEXT NOT NULL,
  PRIMARY KEY (store_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_store_brands_count
  ON store_brands (store_id, product_count DESC);
