-- Fourchette de prix de REFERENCE, issue de sources web citees.
--
-- Table DISTINCTE de price_points, et c'est volontaire : ce ne sont pas des
-- observations, ce sont des estimations sourcees. Les melanger reviendrait a
-- fabriquer un historique qu'on n'a pas mesure.
--
-- Ce qu'on peut reellement trouver sur le web :
--   - prix de lancement / PDSF officiel     -> fiable, citable
--   - couverture editoriale des soldes      -> reel mais approximatif, souvent
--                                              sans date precise
--   - prix courants chez d'autres marchands -> fiable a l'instant T
--
-- Ce qu'on ne peut PAS trouver : une serie temporelle par SKU. Et la couverture
-- s'effondre des qu'on quitte les produits vedettes : les AirPods Pro 2 sont
-- documentes partout, le « Portable 15,6 po Dell LDC15255-A441BLK-PCA » nulle
-- part.

CREATE TABLE price_references (
  product_id     INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,

  -- La fourchette. NULL quand la recherche n'a rien trouve de sourcable.
  launch_price   REAL,   -- PDSF / prix de lancement officiel
  typical_price  REAL,   -- prix courant habituel constate
  known_low      REAL,   -- plus bas prix documente par une source citable
  currency       TEXT NOT NULL DEFAULT 'CAD',

  -- Provenance : sans URL, une affirmation ne vaut rien.
  sources        TEXT NOT NULL DEFAULT '[]',  -- JSON: liste d'URL
  notes          TEXT,                        -- ex. « -218 $ au Black Friday 2024 »

  -- 0..1. Basse par construction : ce sont des estimations, pas des mesures.
  confidence     REAL NOT NULL DEFAULT 0,
  found          INTEGER NOT NULL DEFAULT 0,  -- 0 = rien de sourcable trouve

  model          TEXT,
  cost_usd       REAL,
  checked_at     TEXT NOT NULL
);

CREATE INDEX idx_priceref_found ON price_references(found, checked_at);
