-- LES ADRESSES QUI N'EXISTENT PLUS.
--
-- Le sitemap de Costco annonce 8 775 fiches produit. Quatre-vingt-deux pour
-- cent d'entre elles repondent 404 : ce sont des articles retires du catalogue
-- dont l'adresse est restee publiee. Une requete par fiche, et huit sur dix ne
-- rapportent rien.
--
-- Mesure : 115 requetes par passage, 14 produits releves. A ce rythme, un tour
-- complet du sitemap demanderait plus de deux semaines — autrement dit, les
-- prix Costco ne seraient jamais rafraichis.
--
-- Se souvenir des adresses mortes ramene la liste utile a environ 1 600
-- entrees, soit un tour complet en quelques cycles. Le gain ne vient pas d'une
-- optimisation : il vient de ne plus redemander ce dont on sait deja que ca
-- n'existe plus.
--
-- DEUX ECHECS AVANT DE CONCLURE, ET UNE PEREMPTION. Un 404 unique peut etre un
-- accident de leur cote ; deux, non. Et un article peut revenir au catalogue :
-- passe le delai de peremption, l'adresse est retentee comme si de rien
-- n'etait. Oublier definitivement serait aussi faux que ne rien retenir.
CREATE TABLE IF NOT EXISTS url_mortes (
  store_id   TEXT NOT NULL,
  url        TEXT NOT NULL,
  echecs     INTEGER NOT NULL DEFAULT 1,
  dernier    TEXT NOT NULL,
  PRIMARY KEY (store_id, url)
);
