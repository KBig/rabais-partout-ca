-- Avis clients retenus pour affichage.
--
-- L'endpoint d'avis est DEJA appele par l'enrichissement pour obtenir la note
-- et le taux de recommandation : le texte arrivait dans la meme reponse et
-- etait jete. Le conserver ne coute aucune requete supplementaire.
--
-- On n'en garde que deux : le plus utile parmi les favorables, et le plus utile
-- parmi les critiques. Aligner cinq avis elogieux n'aide personne a decider ;
-- ce qu'on cherche avant d'acheter, c'est « qu'est-ce qui cloche ? ».
ALTER TABLE product_enrichment ADD COLUMN reviews TEXT;
