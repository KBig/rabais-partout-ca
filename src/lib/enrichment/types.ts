/**
 * Couche d'enrichissement.
 *
 * Règle du projet : quand une information manque, on va la CHERCHER. On ne se
 * rabat pas sur une valeur neutre en espérant que ça passe.
 *
 * Mais chercher ne suffit pas : une source peut se tromper. Chaque fait porte
 * donc sa provenance et sa fiabilité, et le résolveur mesure l'ACCORD entre
 * sources. Concrètement :
 *   - 3 sources concordantes  -> accord ~1, on peut se fier au résultat ;
 *   - 2 sources qui divergent -> accord bas, ET le conflit est conservé.
 *
 * C'est ce qui distingue un système robuste d'un système qui se trompe avec
 * assurance : ici, l'incertitude reste visible et mesurable.
 */

export interface ProductRef {
  id: number;
  storeId: string;
  storeSku: string;
  title: string;
  url: string;
  brand: string | null;
  model: string | null;
  categorySlug: string | null;
  currentPrice: number | null;
}

/** Faits qu'une source sait produire. Tout est optionnel : on prend ce qu'on a. */
export interface EnrichedFacts {
  brand?: string | null;
  model?: string | null;
  manufacturer?: string | null;

  rating?: number | null;
  ratingCount?: number | null;
  /** Histogramme des notes, clés « 1 ».. « 5 ». */
  ratingHistogram?: Record<string, number> | null;
  /** Binomiale recommandation : autorise une borne de Wilson. */
  recommendYes?: number | null;
  recommendTotal?: number | null;

  /**
   * Prix officiel publie par le FABRICANT — l'ancre de reference la plus
   * fiable qui existe, puisqu'elle vient de celui qui fixe le prix.
   */
  manufacturerPrice?: number | null;
  manufacturerName?: string | null;
  manufacturerUrl?: string | null;
}

export interface SourceResult {
  sourceId: string;
  facts: EnrichedFacts;
  /**
   * Fiabilité intrinsèque de la source, 0..1.
   * Le marchand lui-même est très fiable pour SES propres données ;
   * un rapprochement inter-magasins l'est moins (risque de faux appariement).
   */
  reliability: number;
}

export interface EnrichmentSource {
  id: string;
  /** Fiabilité par défaut des faits produits par cette source. */
  reliability: number;
  /** Cette source peut-elle traiter ce produit ? (ex : bon magasin) */
  supports(product: ProductRef): boolean;
  fetch(product: ProductRef, http: EnrichmentHttp): Promise<EnrichedFacts | null>;
}

export interface EnrichmentHttp {
  getJson: <T = any>(url: string, init?: RequestInit) => Promise<T>;
  getText: (url: string, init?: RequestInit) => Promise<string>;
}

export interface ResolvedEnrichment {
  facts: EnrichedFacts;
  sources: string[];
  /** 0..1 — à quel point les sources se confirment mutuellement. */
  agreement: number;
  /** Désaccords constatés, conservés pour diagnostic et affichage. */
  conflicts: string[];
  status: 'ok' | 'partial' | 'failed';
}
