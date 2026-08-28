-- Chaine de replis pour les images produit.
--
-- Une seule URL est fragile : les CDN marchands hebergent plusieurs tailles
-- (1500x1500, 500x500, 150x150) et TOUTES n'existent pas pour chaque article.
-- Une fiche pouvait donc afficher l'icone d'image brisee alors que l'image
-- existait, simplement dans une autre resolution.
--
-- On conserve maintenant plusieurs candidates par ordre de preference ; le
-- composant d'affichage descend la liste jusqu'a ce que l'une charge.
ALTER TABLE products ADD COLUMN image_urls TEXT;
