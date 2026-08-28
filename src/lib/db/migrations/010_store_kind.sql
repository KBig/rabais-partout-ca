-- Nature de la source : detaillant ou fabricant.
--
-- Les deux jouent des roles differents dans l'evaluation :
--
--   detaillant  -> son prix est une OFFRE, comparable aux autres offres
--   fabricant   -> son prix est le PDSF, c'est-a-dire la REFERENCE
--
-- Un MacBook a 1 099 $ chez un detaillant face aux 1 299 $ publies par Apple,
-- c'est un rabais reel de 200 $, etabli sans aucun historique et sans rien
-- deviner. Le prix du fabricant fait autorite la ou un article de blog ne fait
-- qu'approximer, et il ne coute rien a obtenir.
ALTER TABLE stores ADD COLUMN kind TEXT NOT NULL DEFAULT 'retailer';

CREATE INDEX idx_stores_kind ON stores(kind, enabled);
