import { db, nowIso } from '../db/index';
import { computeStats, type PricePoint, type PriceStats } from './stats';
import { computeAllPeerStats, type PeerStats } from './peers';

/**
 * Moteur de score.
 *
 * Trois règles structurent tout le calcul :
 *
 *  1. LA QUALITÉ MULTIPLIE, ELLE NE S'ADDITIONNE PAS.
 *     Si on additionnait « rabais » et « note », un produit 1,8 étoile à -80 %
 *     finirait quand même en tête. En multipliant par une porte de qualité
 *     (0,35 à 1,0), un mauvais produit ne PEUT PAS atteindre le sommet.
 *
 *  2. LE PRIX RÉGULIER DU MARCHAND EST UNE HYPOTHÈSE, PAS UN FAIT.
 *     On lui accorde du poids seulement tant qu'on n'a pas notre propre
 *     historique. Dès qu'on a des données, c'est notre médiane qui tranche.
 *
 *  3. ON NE BLUFFE PAS SUR LE DÉMARRAGE À FROID.
 *     Le champ `confidence` dit honnêtement à quel point le score est solide.
 *
 *  4. QUATRE SIGNAUX INDÉPENDANTS, JAMAIS UN SEUL.
 *     - historique  : « moins cher qu'AVANT ? »            (le meilleur, mais lent)
 *     - pairs       : « moins cher que ses ÉQUIVALENTS ? » (dispo jour 1)
 *     - référence   : fourchette web sourcée               (rare, mais précieuse)
 *     - marchand    : le prix barré                        (toujours là, jamais sûr)
 *     Ils sont combinés par moyenne pondérée par leur FIABILITÉ respective.
 *     Quand l'un manque, les autres portent le score : pas de point unique
 *     de défaillance dans l'évaluation.
 */

const WINDOW_DAYS = 90;

/**
 * Force de l'a priori bayésien, en nombre d'avis. Volontairement FAIBLE.
 *
 * Un a priori fort (30) a produit un bug net au premier essai : un produit
 * « 1 étoile sur 1 avis » héritait quasi entièrement de la moyenne globale et
 * obtenait une qualité de 0,81. Correct au sens bayésien, catastrophique en
 * pratique. Voir qualityIndex() pour le vrai correctif.
 */
const RATING_PRIOR = 5;

/**
 * Valeur de qualité attribuée quand on ne sait pas. Ni récompense, ni punition.
 * C'est la cible vers laquelle on ramène les produits peu évalués.
 */
const UNKNOWN_QUALITY = 0.45;

/** Nombre d'avis à partir duquel on considère la note pleinement informative. */
const REVIEWS_FOR_FULL_EVIDENCE = 50;

/**
 * Amortissement pour le RISQUE lié à l'état — et rien d'autre.
 *
 * Le désavantage de prix est déjà traité par CONDITION_EXPECTED_DISCOUNT, qui
 * retranche l'écart normalement consenti sur un article ouvert. Ce facteur-ci
 * ne couvre que le reste : garantie plus courte, traces d'usage possibles,
 * accessoires parfois manquants.
 *
 * Les valeurs étaient auparavant de 0,82 et 0,78, héritées d'une époque où
 * l'écart de prix n'était pas modélisé. Les conserver revenait à pénaliser
 * deux fois le même fait, et plafonnait toute boîte ouverte autour de 55/100,
 * si bonne fût-elle.
 */
const CONDITION_FACTOR: Record<string, number> = {
  new: 1,
  'open-box': 0.93,
  refurbished: 0.9,
};

/**
 * Rabais qu'on ATTEND normalement pour un article non neuf.
 *
 * Un boîte ouverte vendu 15 % sous le prix du neuf n'est pas une affaire :
 * c'est le tarif habituel de la boîte ouverte. Une affaire, c'est ce qui
 * DÉPASSE cet écart attendu.
 *
 * Sans cette correction, deux erreurs symétriques se produisaient. Comparés au
 * neuf sans ajustement, tous les articles ouverts paraissaient d'excellentes
 * affaires. Comparés entre eux (la version précédente), ils perdaient tout
 * intérêt : 2 sur 5 561 dépassaient 50 de score.
 */
const CONDITION_EXPECTED_DISCOUNT: Record<string, number> = {
  new: 0,
  'open-box': 0.15,
  refurbished: 0.22,
};

/** Baisse (vs médiane) qui sature le signal. -40 % = déjà exceptionnel. */
const MAX_MEANINGFUL_DROP = 0.4;

/** Rabais annoncé qui sature le signal marchand. */
const MAX_CLAIMED_DISCOUNT = 0.45;

/** Jours d'historique nécessaires pour une confiance pleine. */
const DAYS_FOR_FULL_CONFIDENCE = 30;

/**
 * Fiabilité accordée au prix barré du marchand. Faible et FIXE : contrairement
 * aux deux autres signaux, elle ne peut jamais augmenter, parce qu'on n'a aucun
 * moyen de la vérifier. Elle sert de filet quand rien d'autre n'est disponible.
 */
const MERCHANT_RELIABILITY = 0.3;

/** Écart au prix médian des pairs qui sature le signal de comparaison. */
const MAX_PEER_ADVANTAGE = 0.3;

/** Taille de groupe donnant une confiance pleine à la comparaison par pairs. */
const PEERS_FOR_FULL_CONFIDENCE = 40;

/**
 * Fiabilité maximale du signal de référence web.
 *
 * Au-dessus du prix barré du marchand (0,3), parce qu'il est SOURCÉ ; en
 * dessous de notre propre historique, parce qu'il reste grossier : la
 * couverture éditoriale donne « autour de 218 $ au Black Friday », pas une
 * série datée. Elle est en outre multipliée par la confiance rapportée pour
 * la source elle-même.
 */
const MAX_REFERENCE_RELIABILITY = 0.45;

/** Écart sous le prix habituel de référence qui sature ce signal. */
const MAX_REFERENCE_ADVANTAGE = 0.3;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface ScoreResult {
  score: number;
  confidence: number;
  dropVsMedian: number;
  pricePercentile: number;
  isLowestEver: boolean;
  daysOfHistory: number;
  qualityScore: number;
  claimedDiscount: number;
  fakeDealPenalty: number;
  median: number;
  minEver: number;
  maxEver: number;
  peerPercentile: number | null;
  peerBelowMedian: number | null;
  peerSize: number | null;
  peerMedian: number | null;
  peerKey: string | null;
  reasons: string[];
}

/**
 * Indice de qualité 0-1, en deux temps.
 *
 * ÉTAPE 1 — correction bayésienne légère : « 5,0 sur 3 avis » est ramené un
 * peu vers la moyenne globale, sans être écrasé.
 *
 * ÉTAPE 2 — LE point important : on interpole vers UNKNOWN_QUALITY (0,45) en
 * fonction du VOLUME d'avis. Manquer d'information doit conduire à « on ne
 * sait pas », surtout pas à « c'est probablement bien ».
 *
 * C'est ce qui corrige le défaut observé au premier crawl, où un produit
 * « 1 étoile sur 1 avis » ressortait à 0,81 de qualité.
 *
 *   4,6 sur 2 400 avis -> 0,89  (preuve pleine, bonne note)
 *   5,0 sur   3 avis   -> 0,64  (bonne note, mais preuve mince)
 *   1,0 sur   1 avis   -> 0,42  (mauvaise note, preuve quasi nulle)
 *   aucun avis         -> 0,45  (inconnu)
 *
 * L'étalement sur 3,0-4,8 plutôt que 0-5 est délibéré : en pratique presque
 * tous les produits notés vivent entre 3,5 et 5,0, et un mappage linéaire sur
 * 0-5 écraserait toutes les différences utiles.
 */
function qualityIndex(
  rating: number | null,
  count: number | null,
  globalMean: number,
  recommendYes: number | null = null,
  recommendTotal: number | null = null,
): number {
  // METHODE 1 (preferee) : borne de Wilson sur la binomiale
  // « recommande / ne recommande pas ». Disponible des que enrichment/ a tourne.
  if (recommendTotal && recommendTotal > 0 && recommendYes !== null) {
    const lower = wilsonLowerBound(recommendYes, recommendTotal);
    // Etalement : meme un produit mediocre descend rarement sous 25 % de
    // recommandation, donc on recentre la plage reellement utile.
    return clamp((lower - 0.25) / 0.73);
  }

  // METHODE 2 (repli) : etoiles ponderees par le volume d'avis.
  if (rating === null || !count || count <= 0) return UNKNOWN_QUALITY;

  const bayes = (count * rating + RATING_PRIOR * globalMean) / (count + RATING_PRIOR);
  const observed = clamp((bayes - 3.0) / 1.8);
  const evidence = clamp(Math.log10(1 + count) / Math.log10(1 + REVIEWS_FOR_FULL_EVIDENCE));

  return lerp(UNKNOWN_QUALITY, observed, evidence);
}

/**
 * Borne inferieure de l'intervalle de confiance de Wilson sur une proportion.
 *
 * C'est LA bonne facon de classer par qualite quand les tailles d'echantillon
 * varient enormement. Au lieu de demander « quel est le taux observe ? », elle
 * demande « quel est le taux le PLUS BAS compatible avec ce qu'on a vu ? ».
 * Un petit echantillon est donc penalise automatiquement, sans regle ad hoc :
 *
 *   991 / 1054 recommandent -> 0,930  (preuve massive que c'est bon)
 *     1 /    1 recommande   -> 0,379  (aucune preuve, aucun credit)
 *   300 / 1000 recommandent -> 0,281  (preuve massive que c'est mauvais)
 *
 * z = 1,28 correspond a une borne unilaterale a 90 %.
 */
export function wilsonLowerBound(positive: number, total: number, z = 1.28): number {
  if (total <= 0) return 0;
  const p = positive / total;
  const z2 = z * z;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total);
  return Math.max(0, (centre - margin) / (1 + z2 / total));
}

export interface ScoreInput {
  currentPrice: number;
  listPrice: number | null;
  inStock: number | null;
  rating: number | null;
  ratingCount: number | null;
  condition: string;
  points: PricePoint[];
  /** Distribution du groupe de produits équivalents (voir pricing/peers.ts). */
  peer?: PeerStats | null;
  globalMeanRating: number;
  /** Issus de la couche d'enrichissement (product_enrichment). */
  recommendYes?: number | null;
  recommendTotal?: number | null;
  /** Accord inter-sources 0..1 ; renforce la confiance quand il est eleve. */
  enrichmentAgreement?: number | null;
  /**
   * Les avis proviennent d'une AUTRE variante du meme modele (typiquement la
   * version neuve d'un article boite ouverte). L'information reste valable —
   * c'est le meme appareil — mais elle est signalee comme empruntee.
   */
  inheritedQuality?: boolean;
  /** Fourchette de reference issue de sources web citees (voir enrichment/reference.ts). */
  reference?: {
    typicalPrice: number | null;
    knownLow: number | null;
    confidence: number;
  } | null;
  now?: number;
}

export function scoreProduct(input: ScoreInput): ScoreResult | null {
  const { currentPrice, listPrice, rating, ratingCount, globalMeanRating } = input;
  const now = input.now ?? Date.now();
  if (!(currentPrice > 0)) return null;

  const stats: PriceStats | null = computeStats(input.points, currentPrice, WINDOW_DAYS, now);
  if (!stats) return null;

  const reasons: string[] = [];

  // --- 1. Signal issu de NOTRE historique ----------------------------------
  const dropVsMedian = stats.median > 0 ? (stats.median - currentPrice) / stats.median : 0;
  const fromDrop = clamp(dropVsMedian / MAX_MEANINGFUL_DROP);
  const fromPercentile = 1 - stats.percentile; // jamais vu aussi bas -> 1
  // « Plus bas jamais vu » est une affirmation FORTE : elle merite un plancher
  // de preuve. Sans ce garde-fou, deux releves espaces de quelques heures
  // suffisaient a decrocher le badge, ce qui est vrai au sens litteral et
  // trompeur en pratique. On exige un vrai changement observe ET quelques jours
  // de recul avant de l'annoncer.
  const MIN_DAYS_FOR_LOWEST_CLAIM = 3;
  const isLowestEver =
    currentPrice <= stats.minEver + 0.005 &&
    stats.changes > 0 &&
    stats.daysObserved >= MIN_DAYS_FOR_LOWEST_CLAIM;

  const historySignal = clamp(
    0.55 * fromDrop + 0.45 * fromPercentile + (isLowestEver ? 0.15 : 0),
  );

  // --- 2. Signal annoncé par le marchand (plafonné à 80 %) -----------------
  const claimedDiscount = listPrice && listPrice > currentPrice
    ? (listPrice - currentPrice) / listPrice
    : 0;
  const merchantSignal = clamp(claimedDiscount / MAX_CLAIMED_DISCOUNT) * 0.8;

  // --- 2bis. Signal de PAIRS (disponible dès le premier crawl) -------------
  // « Ce produit est-il moins cher que ses équivalents, maintenant ? »
  // Aucun historique requis : c'est ce qui rend le système utile jour 1.
  const peer = input.peer ?? null;
  let peerSignal = 0;
  let confPeer = 0;
  // Un produit marque « outsider » est probablement mal classe, pas
  // exceptionnellement bon marche : on refuse de tirer une conclusion de sa
  // position dans un groupe auquel il n'appartient vraisemblablement pas.
  if (peer && peer.size >= 5 && !peer.isOutlier) {
    // On retranche le rabais normalement attendu pour cet état : seul l'écart
    // au-delà de cette attente constitue une vraie affaire.
    const expected = CONDITION_EXPECTED_DISCOUNT[input.condition] ?? 0;
    const advantage = peer.belowMedian - expected;

    peerSignal = clamp(
      0.6 * clamp(advantage / MAX_PEER_ADVANTAGE) + 0.4 * (1 - peer.percentile),
    );
    // La COHESION est le garde-fou. Un groupe dont les prix s'etalent de 30 $
    // a 3 000 $ ne compare pas des produits substituables : plutot que de
    // conclure a tort, on annule la fiabilite du signal, donc son poids.
    confPeer =
      clamp(Math.log10(peer.size) / Math.log10(PEERS_FOR_FULL_CONFIDENCE)) * peer.cohesion;
  }

  // --- 2ter. Signal de REFERENCE externe -----------------------------------
  // Fourchette trouvee sur le web et citee. Rare : la plupart des produits de
  // detail ne font l'objet d'aucune couverture. Quand elle existe, elle est
  // precieuse car independante du marchand ET de notre propre catalogue.
  const ref = input.reference ?? null;
  let referenceSignal = 0;
  let confReference = 0;
  if (ref && ref.confidence > 0 && (ref.typicalPrice || ref.knownLow)) {
    const belowTypical =
      ref.typicalPrice && ref.typicalPrice > 0
        ? (ref.typicalPrice - currentPrice) / ref.typicalPrice
        : 0;
    // Atteindre le plus bas jamais documente est un signal fort en soi.
    const atKnownLow = ref.knownLow ? currentPrice <= ref.knownLow * 1.02 : false;

    referenceSignal = clamp(
      clamp(belowTypical / MAX_REFERENCE_ADVANTAGE) * 0.75 + (atKnownLow ? 0.35 : 0),
    );
    confReference = MAX_REFERENCE_RELIABILITY * ref.confidence;
  }

  // --- 3. Confiance --------------------------------------------------------
  const confHistory = clamp(stats.daysObserved / DAYS_FOR_FULL_CONFIDENCE);
  const confReviews = ratingCount ? clamp(Math.log10(1 + ratingCount) / Math.log10(201)) : 0;
  const confChanges = clamp(stats.changes / 4);

  // Un fait corrobore par plusieurs sources vaut mieux qu'un fait isole :
  // l'accord inter-sources remonte donc directement dans la confiance.
  const confEnrichment = input.enrichmentAgreement ?? 0;
  const hasStrongQualityEvidence = Boolean(input.recommendTotal && input.recommendTotal >= 20);

  const confidence = clamp(
    0.32 * confHistory +
      0.16 * confPeer +
      0.12 * confReference +
      0.15 * confReviews +
      0.07 * confChanges +
      0.1 * confEnrichment +
      (hasStrongQualityEvidence ? 0.1 : 0),
  );

  // --- 4. Détection de faux rabais ----------------------------------------
  let fakeDealPenalty = 0;

  // 4a. PRIX RÉGULIER IMPLAUSIBLE — détection SANS historique.
  //
  // C'est le contrôle le plus important du moteur, et il manquait. Cas réel :
  // un PC de jeu à 1 499 $ annoncé « régulier 2 999 $ ». Le système lui donnait
  // 58/100. Or 2 999 $ dépasse le prix de presque tous les ordinateurs
  // comparables : ce n'est pas un prix, c'est une fiction destinée à gonfler
  // le rabais. Le « rabais » ne fait que ramener la machine à sa valeur réelle.
  //
  // Les autres contrôles de faux rabais exigent de l'historique, donc restaient
  // muets pendant les premières semaines — exactement quand le site est le plus
  // vulnérable à ce genre d'affichage.
  if (
    peer &&
    peer.size >= 8 &&
    peer.cohesion > 0.35 &&
    !peer.isOutlier &&
    listPrice &&
    claimedDiscount > 0.2
  ) {
    // Le « régulier » dépasse-t-il ce que coûtent réellement les équivalents ?
    const regularVsPeers = peer.p90 > 0 ? listPrice / peer.p90 : 0;
    // Et le prix « soldé » atterrit-il simplement au prix normal du marché ?
    const landsAtMarketPrice = peer.p50 > 0 ? currentPrice / peer.p50 : 0;

    if (regularVsPeers > 1.05 && landsAtMarketPrice > 0.7) {
      // Plus le régulier est hors marché, plus la pénalité est lourde.
      const implausibility = clamp((regularVsPeers - 1.05) / 0.6);
      fakeDealPenalty = Math.max(fakeDealPenalty, clamp(0.35 + 0.5 * implausibility));
      reasons.push(
        `Prix « régulier » de ${listPrice.toFixed(2)} $ supérieur à celui de la quasi-totalité des produits comparables`,
      );
    }
  }

  // 4b. Le marchand annonce une remise, mais notre historique dit que le prix
  // n'a jamais été plus haut : le « régulier » est fictif.
  if (confHistory > 0.25 && claimedDiscount > 0.15 && dropVsMedian < 0.02) {
    fakeDealPenalty = Math.max(
      fakeDealPenalty,
      clamp((claimedDiscount - Math.max(0, dropVsMedian)) * 0.9),
    );
    reasons.push('Rabais annoncé non confirmé par notre historique');
  }
  // Rabais permanent : « en solde » quasiment tout le temps = prix normal.
  if (stats.claimShare > 0.85 && stats.daysObserved > 14) {
    fakeDealPenalty = Math.max(fakeDealPenalty, 0.35);
    reasons.push('Affiché « en solde » en permanence');
  }

  // --- 3bis. Fusion des trois signaux --------------------------------------
  // Moyenne pondérée par la FIABILITÉ de chaque source, pas par une constante
  // arbitraire. Conséquence directe : le poids se déplace tout seul vers la
  // meilleure source disponible à mesure que le système accumule des données,
  // sans qu'aucun seuil n'ait à être codé en dur.
  // Un rabais jugé fictif ne doit plus peser via le signal marchand : c'est
  // précisément ce signal qui est mensonger. On le neutralise à la source
  // plutôt que de le laisser contribuer puis de le soustraire.
  const trustedMerchantSignal = merchantSignal * (1 - fakeDealPenalty);

  const contributions = (
    [
      [trustedMerchantSignal, MERCHANT_RELIABILITY],
      [historySignal, confHistory],
      [peerSignal, confPeer * 0.8], // légèrement décoté : moins précis que l'historique
      [referenceSignal, confReference],
    ] as Array<[number, number]>
  ).filter(([, w]) => w > 0);

  const totalWeight = contributions.reduce((sum, [, w]) => sum + w, 0);
  const valueSignalRaw =
    totalWeight > 0
      ? contributions.reduce((sum, [v, w]) => sum + v * w, 0) / totalWeight
      : 0;

  const dealSignal = clamp(valueSignalRaw - fakeDealPenalty);

  // --- 5. Porte de qualité (MULTIPLICATIVE, pas additive) ------------------
  // Un mauvais produit ne peut structurellement pas atteindre le sommet, quel
  // que soit son rabais : la porte plafonne son score à 35 % du signal.
  const quality01 = qualityIndex(
    rating,
    ratingCount,
    globalMeanRating,
    input.recommendYes ?? null,
    input.recommendTotal ?? null,
  );
  const qualityGate = 0.35 + 0.65 * quality01;

  // --- 6. Ajustements ------------------------------------------------------
  // Un rabais de 30 % sur un article à 5 $ économise 1,50 $. Sur un téléviseur
  // à 2 000 $, il économise 600 $. À rabais égal, le second compte davantage.
  const savings = Math.max(0, stats.median - currentPrice, listPrice ? listPrice - currentPrice : 0);
  const amountBoost = 0.75 + 0.25 * clamp(Math.log10(1 + savings) / Math.log10(501));

  // Un deal qu'on ne peut pas acheter n'est pas un deal.
  const stockFactor = input.inStock === 0 ? 0.3 : 1;

  const conditionFactor = CONDITION_FACTOR[input.condition] ?? 1;

  // Amortissement par la confiance : un score doit rester COMPARABLE dans le
  // temps. Sans ça, le jour 1 affiche des 75/100 alors qu'on ne fait que
  // répéter le marchand. Ici un deal non vérifié plafonne vers 55 % de sa
  // valeur, et regagne le reste à mesure que l'historique s'accumule.
  const trustFactor = 0.55 + 0.45 * confidence;

  const score =
    clamp(dealSignal * qualityGate * amountBoost * stockFactor * conditionFactor * trustFactor) *
    100;

  // --- 7. Explications lisibles -------------------------------------------
  if (isLowestEver) {
    reasons.unshift(
      stats.daysObserved >= 60
        ? `Plus bas prix depuis ${Math.round(stats.daysObserved)} jours`
        : `Plus bas prix depuis ${Math.round(stats.daysObserved)} jours de suivi`,
    );
  } else if (
    currentPrice <= stats.minEver + 0.005 &&
    stats.changes > 0 &&
    stats.daysObserved > 0
  ) {
    // Techniquement au plus bas, mais sur trop peu de recul pour l'annoncer.
    reasons.push('Au plus bas de notre suivi, mais le recul est encore mince');
  }
  if (dropVsMedian >= 0.08) {
    reasons.push(`${Math.round(dropVsMedian * 100)} % sous le prix habituel (${stats.median.toFixed(2)} $)`);
  }
  if (peer && peer.size >= 5 && !peer.isOutlier && peer.cohesion > 0.35 && peer.belowMedian >= 0.1) {
    const expected = CONDITION_EXPECTED_DISCOUNT[input.condition] ?? 0;
    reasons.push(
      expected > 0
        ? `${Math.round(peer.belowMedian * 100)} % sous le prix du neuf équivalent ` +
          `(${peer.size} produits ; ${Math.round(expected * 100)} % étant l'écart habituel pour cet état)`
        : `${Math.round(peer.belowMedian * 100)} % sous la médiane de ${peer.size} produits équivalents`,
    );
  }
  if (ref && ref.confidence > 0) {
    if (ref.knownLow && currentPrice <= ref.knownLow * 1.02) {
      reasons.push(`Au niveau du plus bas prix documenté (${ref.knownLow.toFixed(2)} $, source externe)`);
    } else if (ref.typicalPrice && currentPrice < ref.typicalPrice * 0.9) {
      reasons.push(
        `${Math.round((1 - currentPrice / ref.typicalPrice) * 100)} % sous le prix habituel estimé (source externe)`,
      );
    }
  }
  if (claimedDiscount >= 0.1 && fakeDealPenalty === 0) {
    reasons.push(`Rabais marchand de ${Math.round(claimedDiscount * 100)} %`);
  }
  if (input.recommendTotal && input.recommendTotal >= 20 && input.recommendYes != null) {
    const pct = Math.round((input.recommendYes / input.recommendTotal) * 100);
    const source = input.inheritedQuality ? ' du modèle neuf' : '';
    reasons.push(
      `${pct} % le recommandent (${input.recommendTotal.toLocaleString('fr-CA')} avis${source})`,
    );
  } else if (rating !== null && ratingCount && ratingCount >= 20) {
    const source = input.inheritedQuality ? ' du modèle neuf' : '';
    reasons.push(
      `${rating.toFixed(1)} sur 5 (${ratingCount.toLocaleString('fr-CA')} avis${source})`,
    );
  } else if (!ratingCount) {
    reasons.push('Aucun avis client');
  }
  if (input.condition === 'open-box') reasons.push('Boîte ouverte');
  if (input.condition === 'refurbished') reasons.push('Remis à neuf');
  if (confHistory < 0.35) {
    reasons.push('Historique encore court — signal à confirmer');
  }
  if (input.inStock === 0) reasons.push('En rupture de stock');

  return {
    score,
    confidence,
    dropVsMedian,
    pricePercentile: stats.percentile,
    isLowestEver,
    daysOfHistory: stats.daysObserved,
    qualityScore: quality01,
    claimedDiscount,
    fakeDealPenalty,
    median: stats.median,
    minEver: stats.minEver,
    maxEver: stats.maxEver,
    peerPercentile: peer?.percentile ?? null,
    peerBelowMedian: peer?.belowMedian ?? null,
    peerSize: peer?.size ?? null,
    peerMedian: peer?.median ?? null,
    peerKey: peer?.key ?? null,
    reasons,
  };
}

interface ProductRow {
  id: number;
  current_price: number | null;
  list_price: number | null;
  in_stock: number | null;
  rating: number | null;
  rating_count: number | null;
  condition: string;
  model: string | null;
  category_slug: string | null;
  store_id: string;
  recommend_yes: number | null;
  recommend_total: number | null;
  agreement: number | null;
  ref_typical: number | null;
  ref_low: number | null;
  ref_confidence: number | null;
}

/**
 * Recalcule le score de tous les produits actifs.
 *
 * Optimisation clé : un SEUL balayage de price_points trié par
 * (product_id, observed_at), consommé en flux. Faire une requête par produit
 * serait des dizaines de milliers d'allers-retours SQLite.
 */
export function scoreAll(now = Date.now()): number {
  const conn = db();

  const globalMeanRating =
    (conn
      .prepare(
        `SELECT AVG(rating) AS m FROM products
          WHERE rating IS NOT NULL AND rating_count >= 5 AND is_active = 1`,
      )
      .get() as { m: number | null }).m ?? 4.3;

  const products = conn
    .prepare<[], ProductRow>(
      `SELECT p.id, p.current_price, p.list_price, p.in_stock, p.rating,
              p.rating_count, p.condition, p.model, p.category_slug, p.store_id,
              e.recommend_yes, e.recommend_total, e.agreement,
              r.typical_price AS ref_typical, r.known_low AS ref_low,
              r.confidence AS ref_confidence
         FROM products p
         LEFT JOIN product_enrichment e ON e.product_id = p.id
         LEFT JOIN price_references   r ON r.product_id = p.id AND r.found = 1
        WHERE p.is_active = 1 AND p.current_price IS NOT NULL`,
    )
    .all();

  if (products.length === 0) return 0;

  // Les groupes de pairs sont calculés en une passe pour tout le catalogue :
  // ils dépendent de la distribution complète, pas d'un produit isolé.
  const peers = computeAllPeerStats();

  // --- Héritage de la qualité entre variantes d'un même modèle -------------
  //
  // Une fiche « boîte ouverte » ne porte presque jamais d'avis : ce sont des
  // unités uniques, remises en vente. Mais le produit NEUF du même modèle en a
  // souvent des centaines — et c'est le même appareil. Ouvrir la boîte ne
  // change pas ce qu'en pensent les acheteurs.
  //
  // Sans cet héritage, un moniteur noté 4,84/5 sur 322 avis retombait à
  // « qualité inconnue » dans sa version ouverte. La porte de qualité étant
  // multiplicative, son score s'en trouvait amputé d'un tiers.
  const qualityByModel = new Map<
    string,
    { rating: number; count: number; recYes: number | null; recTotal: number | null }
  >();

  for (const r of conn
    .prepare<
      [],
      {
        model: string;
        rating: number;
        rating_count: number;
        recommend_yes: number | null;
        recommend_total: number | null;
      }
    >(
      `SELECT p.model, p.rating, p.rating_count,
              e.recommend_yes, e.recommend_total
         FROM products p
         LEFT JOIN product_enrichment e ON e.product_id = p.id
        WHERE p.is_active = 1 AND p.model IS NOT NULL
          AND p.rating IS NOT NULL AND p.rating_count > 0
        ORDER BY p.rating_count ASC`,
    )
    .all()) {
    // Clé normalisée : « AW3425DW » et « aw-3425-dw » désignent le même écran.
    const key = r.model.toUpperCase().replace(/[-\s]/g, '');
    // Tri croissant : la dernière écriture garde le plus gros échantillon.
    qualityByModel.set(key, {
      rating: r.rating,
      count: r.rating_count,
      recYes: r.recommend_yes,
      recTotal: r.recommend_total,
    });
  }

  // Regroupement des points de prix en un seul balayage ordonné.
  const byProduct = new Map<number, PricePoint[]>();
  const rows = conn
    .prepare<[], { product_id: number; price: number; list_price: number | null; in_stock: number | null; observed_at: string }>(
      `SELECT pp.product_id, pp.price, pp.list_price, pp.in_stock, pp.observed_at
         FROM price_points pp
         JOIN products p ON p.id = pp.product_id
        WHERE p.is_active = 1
        ORDER BY pp.product_id, pp.observed_at`,
    )
    .iterate();

  for (const r of rows) {
    let list = byProduct.get(r.product_id);
    if (!list) byProduct.set(r.product_id, (list = []));
    list.push({
      price: r.price,
      listPrice: r.list_price,
      inStock: r.in_stock,
      observedAt: Date.parse(r.observed_at),
    });
  }

  const upsert = conn.prepare(`
    INSERT INTO deal_scores (
      product_id, score, confidence, drop_vs_median, price_percentile,
      is_lowest_ever, days_of_history, quality_score, claimed_discount,
      fake_deal_penalty, median_90d, min_ever, max_ever, reasons, computed_at,
      peer_percentile, peer_below_median, peer_size, peer_median,
      is_active, condition, category_slug, store_id, price, peer_key
    ) VALUES (
      @id, @score, @confidence, @drop, @percentile,
      @lowest, @days, @quality, @claimed,
      @penalty, @median, @minEver, @maxEver, @reasons, @ts,
      @peerPercentile, @peerBelowMedian, @peerSize, @peerMedian,
      1, @condition, @categorySlug, @storeId, @price, @peerKey
    )
    ON CONFLICT(product_id) DO UPDATE SET
      score = excluded.score, confidence = excluded.confidence,
      drop_vs_median = excluded.drop_vs_median,
      price_percentile = excluded.price_percentile,
      is_lowest_ever = excluded.is_lowest_ever,
      days_of_history = excluded.days_of_history,
      quality_score = excluded.quality_score,
      claimed_discount = excluded.claimed_discount,
      fake_deal_penalty = excluded.fake_deal_penalty,
      median_90d = excluded.median_90d, min_ever = excluded.min_ever,
      max_ever = excluded.max_ever, reasons = excluded.reasons,
      computed_at = excluded.computed_at,
      peer_percentile = excluded.peer_percentile,
      peer_below_median = excluded.peer_below_median,
      peer_size = excluded.peer_size,
      peer_median = excluded.peer_median,
      is_active = 1,
      condition = excluded.condition,
      category_slug = excluded.category_slug,
      store_id = excluded.store_id,
      price = excluded.price,
      peer_key = excluded.peer_key
  `);

  const ts = nowIso();
  let count = 0;

  conn.transaction(() => {
    for (const p of products) {
      // Le marchand renvoie 0 — et non NULL — pour un produit sans avis. Un
      // `??` prenait donc ce 0 pour une vraie note, et un article hérité de
      // 322 avis se retrouvait affiché « 0,0 sur 5 ». On teste donc la
      // PRÉSENCE réelle d'une évaluation, pas la simple non-nullité.
      const propres = p.rating && p.rating > 0 && p.rating_count ? p.rating_count : 0;

      const duModele = p.model
        ? qualityByModel.get(p.model.toUpperCase().replace(/[-\s]/g, ''))
        : undefined;

      // ON RETIENT LE PLUS GRAND ÉCHANTILLON, pas « ses avis s'il en a ».
      //
      // Une unité boîte ouverte portait ses propres 11 avis (3,91/5), alors que
      // le MÊME modèle en neuf en avait 884 (4,76/5). Préférer les 11 sous
      // prétexte qu'ils lui appartiennent, c'est jeter la meilleure preuve
      // disponible sur le même appareil — l'inverse exact du principe de Wilson
      // appliqué partout ailleurs dans ce moteur.
      const herite = duModele && duModele.count > propres * 2 ? duModele : undefined;
      const aSesAvis = propres > 0 && !herite;

      const res = scoreProduct({
        currentPrice: p.current_price!,
        listPrice: p.list_price,
        inStock: p.in_stock,
        rating: aSesAvis ? p.rating : (herite?.rating ?? null),
        ratingCount: aSesAvis ? p.rating_count : (herite?.count ?? null),
        condition: p.condition,
        recommendYes: p.recommend_yes ?? herite?.recYes ?? null,
        recommendTotal: p.recommend_total ?? herite?.recTotal ?? null,
        inheritedQuality: Boolean(herite),
        enrichmentAgreement: p.agreement,
        reference:
          p.ref_confidence !== null
            ? {
                typicalPrice: p.ref_typical,
                knownLow: p.ref_low,
                confidence: p.ref_confidence,
              }
            : null,
        peer: peers.get(p.id) ?? null,
        points: byProduct.get(p.id) ?? [],
        globalMeanRating,
        now,
      });
      if (!res) continue;

      upsert.run({
        id: p.id,
        score: res.score,
        confidence: res.confidence,
        drop: res.dropVsMedian,
        percentile: res.pricePercentile,
        lowest: res.isLowestEver ? 1 : 0,
        days: res.daysOfHistory,
        quality: res.qualityScore,
        claimed: res.claimedDiscount,
        penalty: res.fakeDealPenalty,
        median: res.median,
        minEver: res.minEver,
        maxEver: res.maxEver,
        reasons: JSON.stringify(res.reasons),
        ts,
        peerPercentile: res.peerPercentile,
        peerBelowMedian: res.peerBelowMedian,
        peerSize: res.peerSize,
        peerMedian: res.peerMedian,
        condition: p.condition,
        categorySlug: p.category_slug,
        storeId: p.store_id,
        price: p.current_price,
        peerKey: res.peerKey,
      });
      count++;
    }
  })();

  // Les produits retires du catalogue conservent leur ligne de score : on la
  // marque inactive pour qu'elle sorte du classement. Sans ce menage, l'index
  // continuerait de les proposer alors qu'ils ne sont plus achetables.
  conn
    .prepare(
      `UPDATE deal_scores SET is_active = 0
        WHERE is_active = 1
          AND product_id NOT IN (SELECT id FROM products WHERE is_active = 1)`,
    )
    .run();

  return count;
}
