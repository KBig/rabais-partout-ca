-- Index modele -> URL de fiche, construit depuis les sitemaps des fabricants.
--
-- Le prix d'un constructeur est l'ancre de reference la plus fiable, mais
-- encore faut-il trouver sa fiche. Interroger le moteur de recherche du site
-- echoue : ces pages sont rendues en JavaScript et le modele n'apparait meme
-- pas dans le HTML servi.
--
-- Les sitemaps, eux, sont du XML statique publie pour etre parcouru par des
-- robots, et ils listent les fiches produit. Verifie sur Samsung : 36 de nos
-- 40 modeles y sont retrouves avec leur URL directe.
--
-- L'index est conserve ici plutot que reconstruit a chaque produit : un
-- catalogue ne bouge qu'au rythme des sorties, pas a chaque requete.
CREATE TABLE manufacturer_urls (
  brand      TEXT NOT NULL,
  -- Slug de l'URL, normalise : lettres et chiffres seulement, en majuscules.
  model_key  TEXT NOT NULL,
  url        TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (brand, model_key)
);

CREATE INDEX idx_mfg_urls_brand ON manufacturer_urls(brand, fetched_at);
