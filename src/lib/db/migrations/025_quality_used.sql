-- LA QUALITE REELLEMENT UTILISEE PAR LE SCORE.
--
-- Une unite boite ouverte porte ses propres 14 avis, alors que le meme modele
-- en neuf en compte 44. Le moteur retient le plus grand echantillon — c'est le
-- bon choix — mais la fiche affichait toujours les 14 de l'unite.
--
-- Trois nombres differents apparaissaient donc sur le meme ecran : « 44 avis du
-- modele neuf » dans les raisons, « 14 » dans l'encadre qualite, et « sur 10
-- reponses » dans l'explication. Aucun n'etait faux ; ensemble ils donnaient
-- l'impression d'un systeme incoherent.
--
-- On enregistre ce que le score a EFFECTIVEMENT utilise, pour que la fiche
-- montre la meme chose que le calcul.
ALTER TABLE deal_scores ADD COLUMN quality_rating REAL;
ALTER TABLE deal_scores ADD COLUMN quality_count INTEGER;
