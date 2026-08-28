import { db, nowIso } from '../db';

/**
 * Prix de référence issus des FABRICANTS.
 *
 * ----------------------------------------------------------------------------
 * POURQUOI C'EST LA MEILLEURE SOURCE DE RÉFÉRENCE QUI EXISTE
 * ----------------------------------------------------------------------------
 *
 * Pour juger un rabais, il faut savoir ce que le produit vaut normalement.
 * Quatre façons de l'apprendre, de la pire à la meilleure :
 *
 *   1. Le prix barré du marchand      → invérifiable, souvent gonflé
 *   2. Un article de blog de deals    → approximatif, non daté, payant à
 *                                       extraire, et seulement pour les
 *                                       produits vedettes
 *   3. Notre propre historique        → excellent, mais demande des semaines
 *   4. Le prix publié par le FABRICANT → autorité absolue, gratuit, structuré,
 *                                        disponible immédiatement
 *
 * Le prix affiché par Apple pour un MacBook n'est pas une estimation de son
 * prix : c'est SON prix. Un détaillant qui le vend 200 $ moins cher offre un
 * rabais réel de 200 $ — établi sans historique, sans deviner, sans rien payer.
 *
 * Ce module ne fait aucune requête réseau : il rapproche des données déjà
 * collectées. Les fabricants sont crawlés comme n'importe quelle source, puis
 * on relie leurs prix aux offres des détaillants par NUMÉRO DE MODÈLE.
 *
 * Il reste silencieux tant qu'aucun fabricant n'est alimenté, et devient utile
 * dès le premier adaptateur fabricant branché, sans qu'aucun code ne change.
 */

/**
 * Confiance accordée à un prix constructeur.
 *
 * Élevée, mais pas absolue : le rapprochement par numéro de modèle peut se
 * tromper (déclinaisons régionales, variantes de couleur, configurations). On
 * reste en deçà de la certitude pour que le moteur de score ne traite jamais
 * cette valeur comme une observation directe.
 */
const MSRP_CONFIDENCE = 0.9;

/** Clé de rapprochement : « NS-24F201CA26 » et « ns 24f201ca26 » se rejoignent. */
const normalizeModel = (model: string) => model.toUpperCase().replace(/[-\s]/g, '');

export interface MsrpSyncResult {
  matched: number;
  written: number;
}

/**
 * Rapproche les offres des détaillants des prix publiés par les fabricants, et
 * écrit le résultat dans `price_references` — la même table qu'utiliserait une
 * recherche web, donc le moteur de score n'a rien à apprendre de nouveau.
 *
 * Une référence constructeur ÉCRASE une référence issue du web : elle vient de
 * celui qui fixe le prix, pas de quelqu'un qui le rapporte.
 */
export function syncManufacturerReferences(): MsrpSyncResult {
  const conn = db();

  const rows = conn
    .prepare<
      [],
      {
        product_id: number;
        msrp: number;
        source_url: string;
        maker: string;
      }
    >(
      `SELECT r.id                AS product_id,
              m.current_price     AS msrp,
              m.url               AS source_url,
              ms.name             AS maker
         FROM products r
         JOIN stores  rs ON rs.id = r.store_id AND rs.kind = 'retailer'
         JOIN products m  ON m.model IS NOT NULL
                         AND REPLACE(REPLACE(UPPER(m.model), '-', ''), ' ', '')
                           = REPLACE(REPLACE(UPPER(r.model), '-', ''), ' ', '')
         JOIN stores  ms ON ms.id = m.store_id AND ms.kind = 'manufacturer'
        WHERE r.is_active = 1
          AND m.is_active = 1
          AND r.model IS NOT NULL
          AND m.current_price IS NOT NULL
          AND m.current_price > 0`,
    )
    .all();

  if (rows.length === 0) return { matched: 0, written: 0 };

  // Un produit peut correspondre chez plusieurs fabricants (rare, mais un
  // revendeur de marque blanche peut brouiller la clé). On retient le prix le
  // plus élevé : le PDSF est un plafond, pas une promotion.
  const best = new Map<number, { msrp: number; url: string; maker: string }>();
  for (const row of rows) {
    const cur = best.get(row.product_id);
    if (!cur || row.msrp > cur.msrp) {
      best.set(row.product_id, { msrp: row.msrp, url: row.source_url, maker: row.maker });
    }
  }

  const upsert = conn.prepare(`
    INSERT INTO price_references (
      product_id, launch_price, typical_price, known_low, currency,
      sources, notes, confidence, found, model, cost_usd, checked_at
    ) VALUES (
      @id, @msrp, @msrp, NULL, 'CAD',
      @sources, @notes, @confidence, 1, 'manufacturer', 0, @ts
    )
    ON CONFLICT(product_id) DO UPDATE SET
      launch_price  = excluded.launch_price,
      typical_price = excluded.typical_price,
      currency      = excluded.currency,
      sources       = excluded.sources,
      notes         = excluded.notes,
      confidence    = excluded.confidence,
      found         = 1,
      model         = excluded.model,
      checked_at    = excluded.checked_at
  `);

  const ts = nowIso();
  let written = 0;

  conn.transaction(() => {
    for (const [productId, ref] of best) {
      upsert.run({
        id: productId,
        msrp: ref.msrp,
        sources: JSON.stringify([ref.url]),
        notes: `Prix officiel ${ref.maker} : ${ref.msrp.toFixed(2)} $`,
        confidence: MSRP_CONFIDENCE,
        ts,
      });
      written++;
    }
  })();

  return { matched: rows.length, written };
}
