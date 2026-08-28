-- Description du produit.
--
-- L'API de listing de Best Buy renvoie deja `shortDescription` a chaque page :
-- l'information arrivait donc a chaque crawl et etait simplement jetee. La
-- capturer ne coute AUCUNE requete supplementaire.
--
-- Elle sert aussi au moteur : une description contient souvent les attributs
-- qui determinent le prix (capacite, technologie, dimensions) que le titre
-- omet, et que le regroupement par pairs exploite.
ALTER TABLE products ADD COLUMN description TEXT;
