-- Nettoyage des « prix reguliers » aberrants deja en base.
--
-- Le pipeline rejette desormais ces valeurs a l'ingestion, mais les lignes
-- ecrites avant ce garde-fou les conservent. Constate apres un crawl complet :
-- une cartouche d'encre a 29,03 $ affichee « regulier 1 400 $ » (48x), un
-- ustensile a 5,99 $ contre 199,99 $ (33x).
--
-- Meme seuil que MAX_PLAUSIBLE_LIST_RATIO dans core/pipeline.ts : au-dela de
-- 6x le prix paye (soit ~83 % de rabais annonce), ce n'est plus une
-- liquidation, c'est une erreur de saisie.

UPDATE products
   SET list_price = NULL
 WHERE list_price IS NOT NULL
   AND current_price IS NOT NULL
   AND list_price > current_price * 6;

UPDATE price_points
   SET list_price = NULL
 WHERE list_price IS NOT NULL
   AND list_price > price * 6;
