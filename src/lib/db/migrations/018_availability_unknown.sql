-- La disponibilite et le vendeur tiers ont ete ajoutes PENDANT une collecte
-- deja lancee. Node charge ses modules au demarrage : le processus en cours
-- tournait donc sur l'ancien code, et les 279 603 lignes ont pris la valeur
-- par defaut « les-deux » sans que rien n'ait jamais ete mesure.
--
-- Afficher « en ligne et en magasin » sur un produit qu'on n'a pas regarde est
-- pire que de ne rien afficher : c'est une affirmation fausse, indistinguable
-- d'une vraie. On remet donc a « inconnu », et la prochaine collecte ecrira la
-- valeur reellement observee.
UPDATE products SET availability = 'inconnu';
