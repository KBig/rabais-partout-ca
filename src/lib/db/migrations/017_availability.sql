-- Disponibilite et vendeurs tiers.
--
-- Ces informations arrivaient a chaque crawl dans la reponse du marchand et
-- etaient jetees. Or elles changent concretement la decision d'achat :
--
--   availability  -- en ligne seulement ? en magasin seulement ? les deux ?
--                    Un article reserve au magasin demande un deplacement ;
--                    un article en ligne seulement demande une livraison.
--
--   marketplace   -- vendu par un TIERS sur la place de marche du detaillant.
--                    Un quart des articles d'une page de listing en relevent.
--                    Politique de retour, delais et service apres-vente
--                    different de ceux du detaillant : comparer deux prix sans
--                    le savoir revient a comparer deux choses differentes.
ALTER TABLE products ADD COLUMN availability TEXT NOT NULL DEFAULT 'les-deux';
ALTER TABLE products ADD COLUMN marketplace  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN seller_name  TEXT;

CREATE INDEX idx_products_marketplace ON products(marketplace, is_active);
