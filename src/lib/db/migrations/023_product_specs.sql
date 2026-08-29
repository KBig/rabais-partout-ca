-- CARACTERISTIQUES DE CHAQUE PRODUIT, STOCKEES POUR ETRE FILTREES.
--
-- Les regles d'extraction existaient deja et servaient a l'analyse par
-- composante, mais le resultat n'etait calcule qu'a l'affichage d'une fiche.
-- Impossible, dans ces conditions, de demander « les ordinateurs avec un
-- Core i7 et 32 Go » : il aurait fallu analyser 280 000 titres a chaque
-- requete.
--
-- On materialise donc le resultat. Meme extraction, meme source de verite que
-- l'analyse par composante : deux extractions separees finiraient par diverger.
--
-- Une seule valeur par famille et par produit : annoncer « 4K » et « 1080p »
-- pour le meme ecran n'aurait aucun sens, et la contrainte le rend impossible.
CREATE TABLE IF NOT EXISTS product_specs (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  family     TEXT NOT NULL,
  -- Ce que l'utilisateur lit : « Mémoire vive 16 Go ».
  label      TEXT NOT NULL,
  -- Ce sur quoi on filtre : « memoire-vive-16-go ». Stable, sans accent.
  value      TEXT NOT NULL,
  -- Valeur numerique quand il y en a une, pour trier les choix (8, 16, 32).
  metric     REAL,
  PRIMARY KEY (product_id, family)
);

-- Chercher les produits d'une valeur donnee : c'est le sens de lecture du
-- filtre. Sans cet index, chaque filtre balaierait la table entiere.
CREATE INDEX IF NOT EXISTS idx_product_specs_value
  ON product_specs (family, value, product_id);

-- Et l'ordre inverse, pour lister les caracteristiques d'un produit.
CREATE INDEX IF NOT EXISTS idx_product_specs_produit
  ON product_specs (product_id);
