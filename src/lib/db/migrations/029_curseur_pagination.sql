-- OU EN ETAIT-ON DANS LE CATALOGUE ?
--
-- Tous les adaptateurs repartaient de la premiere page a chaque passage et
-- s'arretaient au plafond de produits. Trois consequences, aucune visible dans
-- les journaux :
--
--   1. UN CATALOGUE PLUS GRAND QUE LE PLAFOND N'ETAIT JAMAIS PARCOURU EN
--      ENTIER. Best Buy compte 282 000 produits et le plafond etait de 12 000 :
--      les 270 000 autres n'avaient jamais de releve de prix. Toujours les
--      memes 4 % rafraichis, cycle apres cycle.
--
--   2. Chez Shopify, les pages etant demandees en parallele, elles reviennent
--      dans l'ordre ou elles ARRIVENT — pas dans l'ordre des numeros. Chaque
--      passage voyait donc un sous-ensemble different et arbitraire. D'ou
--      « 12 000 vus, 6 000 nouveaux, 0 changement de prix » : les produits
--      revus n'etaient pas les memes, il n'y avait rien a comparer.
--
--   3. Le plafond ne pouvait pas etre releve sans risque, puisqu'un passage
--      interrompu perdait tout son avancement.
--
-- Retenir la page suivante corrige les trois. La couverture devient complete en
-- quelques cycles, chaque produit est revu a intervalle previsible — condition
-- pour dater une baisse — et le temps devient la seule borne utile, puisqu'une
-- interruption ne coute plus que la page en cours.
--
-- LA PORTEE (`scope`) EST LE RAYON, pas le magasin. Best Buy pagine rayon par
-- rayon derriere un mur de 2 000 produits par requete : un curseur unique pour
-- tout le magasin melangerait des paginations independantes. Chaine vide pour
-- un catalogue parcouru d'un seul tenant, comme chez Shopify.
CREATE TABLE IF NOT EXISTS crawl_cursors (
  store_id     TEXT NOT NULL,
  scope        TEXT NOT NULL DEFAULT '',
  next_page    INTEGER NOT NULL DEFAULT 1,
  -- Tours complets acheves. Sert a servir en priorite ce qui a ete le moins
  -- couvert : sans cela, un rayon termine repartirait de sa page 1 et
  -- consommerait le budget avant que ses voisins aient ete vus une fois.
  laps         INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (store_id, scope)
);
