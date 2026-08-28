/**
 * Statistiques de prix PONDÉRÉES PAR LE TEMPS.
 *
 * Rappel de conception : price_points ne contient que les CHANGEMENTS. Une
 * ligne représente donc un intervalle [observed_at, observation suivante).
 *
 * Conséquence : une moyenne ou une médiane naïve sur les lignes est fausse.
 * Exemple concret — un produit à 899 $ pendant 80 jours, puis 799 $ pendant
 * 2 heures, produit exactement 2 lignes :
 *   - médiane naïve      -> 849 $  (faux : ce prix n'a jamais existé)
 *   - médiane pondérée   -> 899 $  (juste : c'est le prix réel du produit)
 *
 * Sans pondération, un vrai rabais passerait pour du bruit statistique.
 */

export type PriceSource = 'observed' | 'archive' | 'inferred';

export interface PricePoint {
  price: number;
  listPrice: number | null;
  inStock: number | null;
  observedAt: number; // epoch ms
  source?: PriceSource;
}

/**
 * Influence maximale, en jours, d'un point qui ne vient PAS de notre propre
 * surveillance.
 *
 * Un point « observe » signifie : le prix valait X, et on a continue de
 * verifier ensuite. Il represente donc vraiment un intervalle.
 *
 * Un point « archive » signifie : le prix valait X a cet instant precis, et on
 * ignore tout des jours autour. Sans plafond, une seule capture de janvier
 * pretendrait representer six mois de prix et ecraserait la mediane. On borne
 * donc son poids : c'est un echantillon, pas une periode.
 */
const ARCHIVE_MAX_INTERVAL_DAYS = 10;

export interface PriceStats {
  /** Médiane pondérée par le temps sur la fenêtre. */
  median: number;
  /** Part du temps (0..1) passée à un prix STRICTEMENT inférieur au prix courant. */
  percentile: number;
  minInWindow: number;
  maxInWindow: number;
  minEver: number;
  maxEver: number;
  /** Durée réellement observée, en jours. */
  daysObserved: number;
  /** Nombre de changements de prix distincts sur la fenêtre. */
  changes: number;
  /** Part du temps (0..1) où le marchand affichait un « prix régulier » barré. */
  claimShare: number;

  /** Extrêmes sur TOUT l'historique connu, archives comprises, hors fenêtre. */
  minAllTime: number;
  maxAllTime: number;
  /** Étendue totale de l'historique connu, en jours (backfill inclus). */
  daysSpanned: number;
  /** Nombre de relevés issus d'archives, pour pouvoir le dire à l'utilisateur. */
  archivePoints: number;
}

interface Interval {
  price: number;
  hasClaim: boolean;
  weight: number; // durée en ms
}

/**
 * Découpe l'historique en intervalles pondérés, clippés sur la fenêtre.
 * `points` doit être trié par observedAt croissant.
 */
function toIntervals(points: PricePoint[], windowStart: number, now: number): Interval[] {
  const out: Interval[] = [];

  for (let i = 0; i < points.length; i++) {
    const start = points[i].observedAt;
    // Le dernier prix connu court jusqu'à maintenant.
    const end = i + 1 < points.length ? points[i + 1].observedAt : now;

    const from = Math.max(start, windowStart);
    let to = Math.min(end, now);
    if (to <= from) continue;

    const pt = points[i];

    // Un point non observé ne prouve rien sur les jours suivants : on borne
    // son influence au lieu de le laisser couvrir tout l'intervalle.
    if (pt.source && pt.source !== 'observed') {
      to = Math.min(to, from + ARCHIVE_MAX_INTERVAL_DAYS * 86_400_000);
    }
    if (to <= from) continue;

    out.push({
      price: pt.price,
      hasClaim: pt.listPrice !== null && pt.listPrice > pt.price,
      weight: to - from,
    });
  }
  return out;
}

/** Médiane pondérée : on trie par prix et on avance jusqu'à 50 % du poids. */
function weightedMedian(intervals: Interval[]): number {
  if (intervals.length === 0) return NaN;
  const sorted = [...intervals].sort((a, b) => a.price - b.price);
  const total = sorted.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return sorted[Math.floor(sorted.length / 2)].price;

  let acc = 0;
  for (const iv of sorted) {
    acc += iv.weight;
    if (acc >= total / 2) return iv.price;
  }
  return sorted[sorted.length - 1].price;
}

export function computeStats(
  points: PricePoint[],
  currentPrice: number,
  windowDays = 90,
  now = Date.now(),
): PriceStats | null {
  if (points.length === 0) return null;

  const windowStart = now - windowDays * 86_400_000;
  const intervals = toIntervals(points, windowStart, now);

  // Produit vu pour la première fois à l'instant : pas encore d'intervalle
  // mesurable. On renvoie des stats neutres plutôt que rien, pour que le
  // moteur puisse quand même noter avec une confiance très basse.
  const allPricesAll = points.map((x) => x.price);
  const archivePoints = points.filter((x) => x.source && x.source !== 'observed').length;
  const daysSpanned = (now - points[0].observedAt) / 86_400_000;

  if (intervals.length === 0) {
    const p = points[points.length - 1].price;
    return {
      median: p,
      percentile: 0.5,
      minInWindow: p,
      maxInWindow: p,
      minEver: Math.min(...allPricesAll),
      maxEver: Math.max(...allPricesAll),
      daysObserved: 0,
      changes: 0,
      claimShare: 0,
      minAllTime: Math.min(...allPricesAll, currentPrice),
      maxAllTime: Math.max(...allPricesAll, currentPrice),
      daysSpanned,
      archivePoints,
    };
  }

  const totalWeight = intervals.reduce((s, x) => s + x.weight, 0);

  let below = 0;
  let claimWeight = 0;
  let minW = Infinity;
  let maxW = -Infinity;

  for (const iv of intervals) {
    if (iv.price < currentPrice - 0.005) below += iv.weight;
    if (iv.hasClaim) claimWeight += iv.weight;
    if (iv.price < minW) minW = iv.price;
    if (iv.price > maxW) maxW = iv.price;
  }

  const allPrices = points.map((p) => p.price);
  const firstObserved = points[0].observedAt;

  return {
    median: weightedMedian(intervals),
    percentile: totalWeight > 0 ? below / totalWeight : 0.5,
    minInWindow: minW,
    maxInWindow: maxW,
    minEver: Math.min(...allPrices, currentPrice),
    maxEver: Math.max(...allPrices, currentPrice),
    daysObserved: (now - Math.max(firstObserved, windowStart)) / 86_400_000,
    changes: intervals.length - 1,
    claimShare: totalWeight > 0 ? claimWeight / totalWeight : 0,
    minAllTime: Math.min(...allPricesAll, currentPrice),
    maxAllTime: Math.max(...allPricesAll, currentPrice),
    daysSpanned,
    archivePoints,
  };
}
