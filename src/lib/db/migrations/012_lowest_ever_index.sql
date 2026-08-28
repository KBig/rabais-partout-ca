-- Compteur « au plus bas historique » affiche sur la page d'accueil.
-- Sans index, il impose un balayage complet de deal_scores a chaque visite.
CREATE INDEX idx_ds_lowest ON deal_scores(is_active, is_lowest_ever);
