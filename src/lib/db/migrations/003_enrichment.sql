-- Couche d'enrichissement.
--
-- Principe : quand une information manque (marque, avis, modèle), le système
-- va la CHERCHER au lieu de se rabattre sur une valeur neutre. Chaque fait
-- enrichi garde la trace de sa ou ses sources, et un indice d'ACCORD entre
-- elles. Une donnée confirmée par trois sources ne vaut pas une donnée issue
-- d'une seule ; une donnée contredite vaut encore moins.

CREATE TABLE product_enrichment (
  product_id         INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,

  brand              TEXT,
  model              TEXT,
  manufacturer       TEXT,

  rating             REAL,
  rating_count       INTEGER,
  -- Distribution des étoiles (JSON {1..5}) : permet de détecter les produits
  -- polarisants, qu'une simple moyenne masque complètement.
  rating_histogram   TEXT,
  -- Binomiale « recommande / ne recommande pas ». C'est la donnée la plus
  -- exploitable : elle autorise une borne de Wilson, statistiquement correcte.
  recommend_yes      INTEGER,
  recommend_total    INTEGER,

  sources            TEXT NOT NULL DEFAULT '[]',  -- JSON: sources ayant contribué
  agreement          REAL,                        -- 0..1 accord inter-sources
  conflicts          TEXT,                        -- JSON: désaccords constatés

  status             TEXT NOT NULL DEFAULT 'pending', -- pending|ok|partial|failed
  attempts           INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,
  enriched_at        TEXT
);

CREATE INDEX idx_enrich_status ON product_enrichment(status, enriched_at);
