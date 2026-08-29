-- QUI DETIENT LE VERROU DE COLLECTE, ET EST-IL ENCORE VIVANT ?
--
-- Une ligne `crawl_runs` en « running » sert de verrou : elle empeche une
-- deuxieme collecte du meme magasin de partir en parallele, ce qui ferait que
-- les deux se disputent la cadence autorisee et avancent deux fois moins vite.
--
-- Mais un processus tue laisse sa ligne en « running » pour toujours. La seule
-- parade possible jusqu'ici etait un delai : au bout de quatre-vingt-dix
-- minutes, on presumait le processus mort. Ce compromis est mauvais des deux
-- cotes. Trop court, il libere une collecte Costco encore en train de
-- travailler. Trop long, il interdit de recollecter un magasin pendant une
-- heure et demie apres un simple Ctrl+C — c'est exactement ce qui vient
-- d'arriver a Costco, ignore a quatre-vingt-huit minutes.
--
-- On n'a pas besoin de PRESUMER : le systeme d'exploitation sait si un
-- processus existe. On enregistre donc son identifiant, et la machine sur
-- laquelle il tourne.
--
-- La machine est indispensable. Un identifiant de processus n'a de sens que
-- localement : le PID 4242 d'un conteneur d'integration continue n'a aucun
-- rapport avec le PID 4242 de cette machine-ci, et les confondre libererait un
-- verrou bien vivant ou en conserverait un mort. Quand l'hote differe, on
-- retombe sur le delai — le seul recours honnete a distance.
ALTER TABLE crawl_runs ADD COLUMN pid INTEGER;
ALTER TABLE crawl_runs ADD COLUMN host TEXT;

CREATE INDEX IF NOT EXISTS idx_crawl_runs_verrou
  ON crawl_runs (store_id, status, started_at);
