-- Cle du groupe de pairs, conservee pour pouvoir interroger le groupe.
--
-- Elle etait calculee en memoire puis jetee. La stocker permet de repondre a
-- une question que l'utilisateur se pose naturellement devant une fiche :
-- « et si je mettais un peu plus cher, j'aurais quoi ? »
--
-- Comparer dans le groupe de pairs plutot que dans la categorie entiere est ce
-- qui rend la reponse utile : proposer un televiseur 85 po a quelqu'un qui
-- regarde un 43 po n'aide personne.
ALTER TABLE deal_scores ADD COLUMN peer_key TEXT;

CREATE INDEX idx_ds_peer ON deal_scores(peer_key, quality_score DESC);
