-- DISTRIBUTION REELLE DE CHAQUE CARACTERISTIQUE, PAR CATEGORIE.
--
-- « 16 Go » n'est ni bon ni mauvais dans l'absolu : tout depend de ce que fait
-- le reste du marche. Un ecran de 165 Hz est haut de gamme parmi les
-- televiseurs et banal parmi les moniteurs de jeu.
--
-- On mesure donc la distribution sur le catalogue lui-meme, categorie par
-- categorie, et on situe chaque produit dedans. Aucune table de valeurs ecrite
-- a la main ne resterait juste six mois : celle-ci se met a jour a chaque
-- collecte, et couvre aussi bien les litres d'une friteuse que les pieds cubes
-- d'un refrigerateur.
CREATE TABLE IF NOT EXISTS spec_distribution (
  category_slug TEXT NOT NULL,
  -- Famille + unite : des litres ne se comparent pas a des pieds cubes.
  metric_key    TEXT NOT NULL,
  n             INTEGER NOT NULL,
  p10           REAL NOT NULL,
  p25           REAL NOT NULL,
  p50           REAL NOT NULL,
  p75           REAL NOT NULL,
  p90           REAL NOT NULL,
  computed_at   TEXT NOT NULL,
  PRIMARY KEY (category_slug, metric_key)
);
