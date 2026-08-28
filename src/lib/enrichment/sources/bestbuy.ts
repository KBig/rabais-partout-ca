import type {
  EnrichmentSource,
  EnrichedFacts,
  ProductRef,
  SelectedReview,
} from '../types';

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

interface BbReview {
  comment?: string | null;
  rating?: number | null;
  reviewerName?: string | null;
  submissionTime?: string | null;
  isVerifiedPurchaser?: boolean;
  totalPositiveFeedbackCount?: number;
}

interface BbReviews {
  customerRating?: number | null;
  customerRatingCount?: number | null;
  Brand?: string | null;
  RatingSummary?: BbRatingSummary | null;
  reviews?: BbReview[];
}

/**
 * Les marchands signalent dans le texte les avis obtenus contre un avantage.
 * Ces avis sont statistiquement plus indulgents : on les marque plutot que de
 * les jeter, et l'interface le dit au lecteur.
 */
const INCENTIVE_MARK =
  /\[?(?:this review was collected as part of a promotion|cet avis a ete recueilli dans le cadre d.une promotion)[^\]]*\]?/i;

/**
 * Retient DEUX avis : le plus utile parmi les favorables, et le plus utile
 * parmi les critiques.
 *
 * Aligner cinq avis elogieux n'aide personne a decider. Ce qu'on cherche avant
 * d'acheter, c'est « qu'est-ce qui cloche ? » — donc un avis de chaque bord,
 * choisis sur l'utilite votee par les autres acheteurs plutot que sur leur date.
 */
function selectReviews(reviews: BbReview[]): SelectedReview[] {
  const utiles = reviews
    .filter((r) => typeof r.comment === 'string' && r.comment.trim().length > 40)
    .map((r) => {
      const brut = r.comment!.trim();
      const incentivized = INCENTIVE_MARK.test(brut);
      return {
        rating: r.rating ?? 0,
        // On retire la mention de promotion du texte : elle est portee par le
        // drapeau, et la repeter dans chaque extrait alourdit la lecture.
        comment: brut.replace(INCENTIVE_MARK, '').trim(),
        author: r.reviewerName ?? null,
        date: r.submissionTime ?? null,
        verified: Boolean(r.isVerifiedPurchaser),
        helpful: r.totalPositiveFeedbackCount ?? 0,
        incentivized,
      } satisfies SelectedReview;
    })
    .filter((r) => r.comment.length > 40);

  // A utilite egale, l'achat verifie l'emporte : c'est la meilleure garantie
  // que l'auteur a reellement eu le produit entre les mains.
  const parPertinence = (a: SelectedReview, b: SelectedReview) =>
    b.helpful - a.helpful || Number(b.verified) - Number(a.verified);

  const favorable = utiles.filter((r) => r.rating >= 4).sort(parPertinence)[0];
  const critique = utiles.filter((r) => r.rating <= 3).sort(parPertinence)[0];

  return [favorable, critique].filter(Boolean) as SelectedReview[];
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
      // Le texte arrivait deja dans cette reponse et etait jete : aucune
      // requete supplementaire.
      reviews: selectReviews(d.reviews ?? []),
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
