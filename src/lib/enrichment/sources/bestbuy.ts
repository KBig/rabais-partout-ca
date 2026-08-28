import type { EnrichmentSource, EnrichedFacts, ProductRef } from '../types';

/**
 * Sources d'enrichissement Best Buy.
 *
 * Le listing utilisé au crawl est volontairement économe et omet la marque et
 * les avis détaillés. Ces deux endpoints comblent le trou, chez le marchand
 * lui-même : c'est la source la plus fiable qui existe pour ses propres
 * données, et elle ne dépend d'aucun tiers.
 *
 *   /api/v2/json/product/{sku}  -> brandName, modelNumber, manufacturer
 *   /api/v2/json/reviews/{sku}  -> note, volume, histogramme, recommandations
 */

const BASE = 'https://www.bestbuy.ca';

interface BbDetail {
  brandName?: string | null;
  modelNumber?: string | null;
  manufacturer?: string | null;
  customerRating?: number | null;
  customerRatingCount?: number | null;
}

interface BbRatingSummary {
  OneStarCount?: number;
  TwoStarCount?: number;
  ThreeStarCount?: number;
  FourStarCount?: number;
  FiveStarCount?: number;
  RecommendedCount?: number;
  NotRecommendedCount?: number;
  OverallAverageScore?: number;
  OverallReviewCount?: number;
}

interface BbReviews {
  customerRating?: number | null;
  customerRatingCount?: number | null;
  Brand?: string | null;
  RatingSummary?: BbRatingSummary | null;
}

/** Marque + numéro de modèle depuis la fiche produit. */
export const bestBuyDetailSource: EnrichmentSource = {
  id: 'bestbuy-detail',
  reliability: 0.97, // le marchand sur ses propres références

  supports: (p: ProductRef) => p.storeId === 'bestbuy-ca',

  async fetch(p, http): Promise<EnrichedFacts | null> {
    const d = await http.getJson<BbDetail>(`${BASE}/api/v2/json/product/${p.storeSku}`);
    if (!d) return null;

    return {
      brand: normalizeBrand(d.brandName),
      model: d.modelNumber?.trim() || null,
      manufacturer: d.manufacturer?.trim() || null,
      // La fiche renvoie souvent null ici ; l'endpoint avis fait autorité.
      rating: typeof d.customerRating === 'number' ? d.customerRating : null,
      ratingCount: typeof d.customerRatingCount === 'number' ? d.customerRatingCount : null,
    };
  },
};

/** Avis complets : note, volume, distribution et taux de recommandation. */
export const bestBuyReviewsSource: EnrichmentSource = {
  id: 'bestbuy-reviews',
  reliability: 0.97,

  supports: (p: ProductRef) => p.storeId === 'bestbuy-ca',

  async fetch(p, http): Promise<EnrichedFacts | null> {
    const d = await http.getJson<BbReviews>(`${BASE}/api/v2/json/reviews/${p.storeSku}`);
    if (!d) return null;

    const s = d.RatingSummary ?? null;

    const histogram = s
      ? {
          '1': s.OneStarCount ?? 0,
          '2': s.TwoStarCount ?? 0,
          '3': s.ThreeStarCount ?? 0,
          '4': s.FourStarCount ?? 0,
          '5': s.FiveStarCount ?? 0,
        }
      : null;

    const yes = s?.RecommendedCount ?? null;
    const no = s?.NotRecommendedCount ?? null;
    const total = yes !== null && no !== null ? yes + no : null;

    return {
      brand: normalizeBrand(d.Brand),
      rating: d.customerRating ?? s?.OverallAverageScore ?? null,
      ratingCount: d.customerRatingCount ?? s?.OverallReviewCount ?? null,
      ratingHistogram: histogram,
      recommendYes: yes,
      recommendTotal: total,
    };
  },
};

/**
 * Best Buy renvoie les marques en majuscules ("INSIGNIA", "LG"). On rétablit
 * une casse lisible tout en préservant les sigles courts (LG, HP, JBL, ASUS).
 */
function normalizeBrand(raw?: string | null): string | null {
  const b = raw?.trim();
  if (!b || b.toLowerCase() === 'bestbuycanada') return null;
  if (b.length <= 4) return b.toUpperCase();
  if (b === b.toUpperCase()) {
    return b
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return b;
}
