-- Provenance des relevés de prix.
--
-- Distinction essentielle, qui change le calcul statistique :
--
--   'observed' : NOUS avons relevé ce prix, et nous avons continué de
--                surveiller ensuite. La ligne represente donc vraiment un
--                INTERVALLE : le prix a tenu jusqu'au relevé suivant.
--
--   'archive'  : prix retrouvé dans une archive web à un instant donné. On ne
--                sait RIEN des jours qui l'entourent. Traiter ce point comme un
--                intervalle ferait qu'une capture de janvier prétendrait
--                représenter six mois de prix. Son influence est donc bornée
--                (voir ARCHIVE_MAX_INTERVAL_DAYS dans pricing/stats.ts).
--
--   'inferred' : déduit d'une autre source (ex : même modèle chez un autre
--                marchand). Le plus faible des trois.

ALTER TABLE price_points ADD COLUMN source TEXT NOT NULL DEFAULT 'observed';

-- Un même instant peut être rapporté par plusieurs archives : on déduplique.
CREATE UNIQUE INDEX idx_pp_unique ON price_points(product_id, observed_at, source);

CREATE INDEX idx_pp_source ON price_points(source);

-- Suivi du backfill, pour ne pas réinterroger sans cesse les mêmes produits
-- alors qu'on sait déjà qu'aucune archive n'existe.
CREATE TABLE backfill_attempts (
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,
  points_found  INTEGER NOT NULL DEFAULT 0,
  oldest_found  TEXT,
  status        TEXT NOT NULL,          -- ok | empty | failed
  error         TEXT,
  attempted_at  TEXT NOT NULL,
  PRIMARY KEY (product_id, source)
);

CREATE INDEX idx_backfill_status ON backfill_attempts(source, status, attempted_at);
