-- QUAND la liste des marques a-t-elle ete DECOUVERTE ?
--
-- Distinguer la decouverte du traitement. Sans cette colonne, une passe
-- partielle (« --only 8 ») n'ecrivait que 8 lignes, et la passe suivante
-- reprenait ces 8 marques en croyant tenir tout le catalogue : 123 marques
-- disparaissaient silencieusement, et rien ne le signalait.
--
-- Desormais chaque slug decouvert est ecrit AUSSITOT, avant tout traitement.
-- La reprise s'appuie sur `discovered_at`, jamais sur le fait qu'une marque
-- ait deja ete resolue.
ALTER TABLE store_brands ADD COLUMN discovered_at TEXT;

-- Les lignes existantes datent d'une decouverte partielle : on les marque
-- comme non decouvertes pour forcer une relecture complete du sitemap.
UPDATE store_brands SET discovered_at = NULL;
