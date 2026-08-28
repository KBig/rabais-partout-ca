-- ============================================================================
-- item-finder : schéma initial
--
-- Principes de conception :
--  1. price_points est APPEND-ONLY et n'enregistre QUE les changements de prix.
--     Un produit stable pendant 6 mois = 1 ligne, pas 180. La base reste
--     minuscule tout en conservant l'historique complet.
--  2. Chaque price_point est donc un INTERVALLE implicite [observed_at, suivant).
--     Toute statistique doit être PONDÉRÉE PAR LE TEMPS (voir pricing/stats.ts).
--  3. products porte un cache dénormalisé de l'état courant pour que le site
--     n'ait jamais à agréger l'historique au moment du rendu.
-- ============================================================================

CREATE TABLE stores (
  id                    TEXT PRIMARY KEY,          -- 'bestbuy-ca'
  name                  TEXT NOT NULL,             -- 'Best Buy Canada'
  country               TEXT NOT NULL DEFAULT 'CA',
  currency              TEXT NOT NULL DEFAULT 'CAD',
  homepage              TEXT,
  color                 TEXT,                      -- couleur de marque pour l'UI
  enabled               INTEGER NOT NULL DEFAULT 1,

  -- Disjoncteur : un magasin qui échoue en boucle se met en pause tout seul
  -- au lieu de marteler le serveur et de se faire blacklister.
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  paused_until          TEXT,

  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Taxonomie canonique, indépendante des magasins. Chaque adaptateur traduit
-- ses propres catégories vers ces slugs, ce qui permet de comparer un TV
-- Best Buy avec un TV Costco dans la même page.
CREATE TABLE categories (
  slug         TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  parent_slug  TEXT REFERENCES categories(slug),
  icon         TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id                    INTEGER PRIMARY KEY,
  store_id              TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  store_sku             TEXT NOT NULL,             -- identifiant interne du marchand
  url                   TEXT NOT NULL,
  title                 TEXT NOT NULL,
  brand                 TEXT,
  model                 TEXT,
  image_url             TEXT,

  category_slug         TEXT REFERENCES categories(slug),
  store_category        TEXT,                      -- chemin brut, pour debug/remapping

  -- Signaux de QUALITÉ. Un rabais sur un mauvais produit n'est pas un deal.
  rating                REAL,                      -- 0..5
  rating_count          INTEGER,

  -- Cache de l'état courant
  currency              TEXT NOT NULL DEFAULT 'CAD',
  current_price         REAL,
  list_price            REAL,                      -- « prix régulier » du marchand (NON fiable)
  in_stock              INTEGER,

  first_seen_at         TEXT NOT NULL,
  last_seen_at          TEXT NOT NULL,
  last_price_change_at  TEXT,
  is_active             INTEGER NOT NULL DEFAULT 1,

  UNIQUE (store_id, store_sku)
);

CREATE INDEX idx_products_store     ON products(store_id, is_active);
CREATE INDEX idx_products_category  ON products(category_slug, is_active);
CREATE INDEX idx_products_lastseen  ON products(last_seen_at);

-- Historique append-only. Une ligne = un changement observé.
CREATE TABLE price_points (
  id           INTEGER PRIMARY KEY,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price        REAL NOT NULL,
  list_price   REAL,
  in_stock     INTEGER,
  observed_at  TEXT NOT NULL
);

CREATE INDEX idx_pp_product ON price_points(product_id, observed_at);

-- Résultat du moteur de score. Recalculé après chaque crawl.
CREATE TABLE deal_scores (
  product_id        INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,

  score             REAL NOT NULL,   -- 0..100, la note finale affichée
  confidence        REAL NOT NULL,   -- 0..1, fiabilité du signal (historique accumulé)

  -- Composantes, conservées pour pouvoir EXPLIQUER le score à l'utilisateur
  -- (« pourquoi ce produit est-il en vedette ? »)
  drop_vs_median    REAL,            -- baisse % vs médiane pondérée 90j
  price_percentile  REAL,            -- 0..1, position du prix dans son historique
  is_lowest_ever    INTEGER NOT NULL DEFAULT 0,
  days_of_history   REAL NOT NULL DEFAULT 0,
  quality_score     REAL,            -- 0..1, note bayésienne
  claimed_discount  REAL,            -- rabais annoncé par le marchand
  fake_deal_penalty REAL NOT NULL DEFAULT 0,  -- 0..1, détection de « faux rabais permanent »

  median_90d        REAL,
  min_ever          REAL,
  max_ever          REAL,

  reasons           TEXT,            -- JSON: libellés lisibles pour l'UI
  computed_at       TEXT NOT NULL
);

CREATE INDEX idx_scores_rank ON deal_scores(score DESC, confidence DESC);

-- Observabilité : chaque passage de crawler est tracé. Sans ça, on ne sait
-- jamais si un magasin est cassé ou juste vide.
CREATE TABLE crawl_runs (
  id               INTEGER PRIMARY KEY,
  store_id         TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  strategy         TEXT NOT NULL,          -- 'deals' | 'category' | 'search'
  target           TEXT,                   -- catégorie ou requête ciblée
  status           TEXT NOT NULL,          -- 'running' | 'ok' | 'partial' | 'failed'
  products_seen    INTEGER NOT NULL DEFAULT 0,
  products_new     INTEGER NOT NULL DEFAULT 0,
  price_changes    INTEGER NOT NULL DEFAULT 0,
  requests_made    INTEGER NOT NULL DEFAULT 0,
  error            TEXT,
  started_at       TEXT NOT NULL,
  finished_at      TEXT
);

CREATE INDEX idx_runs_store ON crawl_runs(store_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- Recherche plein texte (FTS5).
-- `remove_diacritics 2` = « televiseur » trouve « téléviseur ». Indispensable
-- pour un site francophone où personne ne tape les accents dans une recherche.
-- `content=` fait un index externe : le texte n'est pas dupliqué en base.
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE products_fts USING fts5(
  title, brand, model,
  content='products',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER products_fts_ai AFTER INSERT ON products BEGIN
  INSERT INTO products_fts(rowid, title, brand, model)
  VALUES (new.id, new.title, new.brand, new.model);
END;

CREATE TRIGGER products_fts_ad AFTER DELETE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, title, brand, model)
  VALUES ('delete', old.id, old.title, old.brand, old.model);
END;

CREATE TRIGGER products_fts_au AFTER UPDATE ON products BEGIN
  INSERT INTO products_fts(products_fts, rowid, title, brand, model)
  VALUES ('delete', old.id, old.title, old.brand, old.model);
  INSERT INTO products_fts(rowid, title, brand, model)
  VALUES (new.id, new.title, new.brand, new.model);
END;
