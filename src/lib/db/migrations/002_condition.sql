-- État du produit : neuf / boîte ouverte / remis à neuf.
--
-- Motivation : au premier crawl, 7 des 8 meilleurs deals étaient des « Boîte
-- ouverte ». Leur rabais est calculé contre le prix du NEUF, ce qui gonfle
-- mécaniquement leur score. Ce ne sont pas de faux rabais, mais c'est un profil
-- de risque différent : il doit être étiqueté et filtrable, pas dissimulé.

ALTER TABLE products ADD COLUMN condition TEXT NOT NULL DEFAULT 'new';

CREATE INDEX idx_products_condition ON products(condition, is_active);
