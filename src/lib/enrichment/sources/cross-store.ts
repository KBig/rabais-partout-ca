import { db } from '../../db/index';
import type { EnrichmentSource, EnrichedFacts, ProductRef } from '../types';

/**
 * Rapprochement inter-magasins.
 *
 * Le même produit vendu chez plusieurs marchands porte le même numéro de
 * modèle. Si Best Buy n'a que 3 avis sur un téléviseur mais que Costco en a
 * 900, la seconde source est nettement plus informative — et elle est
 * INDÉPENDANTE, ce qui est précieux : deux marchands qui s'accordent valent
 * beaucoup plus qu'un seul qui affirme.
 *
 * Cette source est déjà branchée mais reste silencieuse tant qu'un seul
 * magasin est alimenté. Elle prend de la valeur à chaque magasin ajouté, sans
 * qu'aucun code n'ait à changer.
 *
 * Sa fiabilité est volontairement plus basse que celle d'un marchand sur ses
 * propres données : un rapprochement par modèle peut se tromper (variantes
 * régionales, déclinaisons de couleur, bundles).
 */
export const crossStoreSource: EnrichmentSource = {
  id: 'cross-store',
  reliability: 0.72,

  supports: (p: ProductRef) => Boolean(p.model && p.model.length >= 4),

  async fetch(p): Promise<EnrichedFacts | null> {
    const key = normalizeModel(p.model!);
    if (!key) return null;

    // On ne compare qu'avec les AUTRES magasins : se citer soi-même
    // n'apporterait aucune corroboration.
    const rows = db()
      .prepare<[string, string], { rating: number | null; rating_count: number | null }>(
        `SELECT rating, rating_count
           FROM products
          WHERE store_id != ?
            AND model IS NOT NULL
            AND REPLACE(REPLACE(UPPER(model), '-', ''), ' ', '') = ?
            AND rating IS NOT NULL
            AND is_active = 1`,
      )
      .all(p.storeId, key);

    if (rows.length === 0) return null;

    // Le marchand qui a le plus d'avis est celui qui en sait le plus.
    const best = rows.reduce((a, b) => ((b.rating_count ?? 0) > (a.rating_count ?? 0) ? b : a));

    return {
      rating: best.rating,
      ratingCount: best.rating_count,
    };
  },
};

/** "NS-24F201CA26" et "ns 24f201ca26" doivent donner la même clé. */
function normalizeModel(model: string): string | null {
  const k = model.toUpperCase().replace(/[-\s]/g, '');
  return k.length >= 4 ? k : null;
}
