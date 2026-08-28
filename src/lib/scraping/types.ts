/**
 * Contrat que chaque magasin doit implémenter.
 *
 * Objectif : ajouter un magasin = écrire UN fichier dans stores/ et l'inscrire
 * au registre. Aucune autre partie du système ne change.
 */

/** Produit tel que le magasin nous le donne, avant normalisation. */
export interface RawProduct {
  sku: string;                    // identifiant stable chez le marchand
  url: string;
  title: string;
  brand?: string | null;
  model?: string | null;
  imageUrl?: string | null;
  /** Descriptif court fourni par le marchand, quand il en publie un. */
  description?: string | null;
  /**
   * Images de repli, par ordre de preference. Les CDN marchands n'hebergent
   * pas toutes les resolutions pour tous les articles : sans plusieurs
   * candidates, une fiche affiche une image brisee alors que l'image existe
   * dans une autre taille.
   */
  imageUrls?: string[];

  price: number;                  // prix payé aujourd'hui
  listPrice?: number | null;      // « régulier » annoncé — traité comme suspect
  currency?: string;
  inStock?: boolean | null;

  rating?: number | null;         // 0..5
  ratingCount?: number | null;

  storeCategory?: string | null;  // chemin brut chez le marchand
  categorySlug?: string | null;   // slug canonique, traduit par l'adaptateur

  /** neuf par defaut ; 'open-box' et 'refurbished' sont notes differemment. */
  condition?: ProductCondition;
}

export type ProductCondition = 'new' | 'open-box' | 'refurbished';

export interface CrawlLimits {
  maxPages: number;
  maxProducts: number;
}

/** Boîte à outils fournie par le moteur à l'adaptateur. */
export interface CrawlContext {
  limits: CrawlLimits;
  signal: AbortSignal;
  log: (msg: string) => void;
  /** GET JSON, avec limitation de débit, retries et backoff déjà appliqués. */
  getJson: <T = any>(url: string, init?: RequestInit) => Promise<T>;
  /** GET texte brut (HTML). */
  getText: (url: string, init?: RequestInit) => Promise<string>;
  /** Compteur de requêtes, pour les stats de run. */
  requests: () => number;
}

export type CrawlStrategy = 'deals' | 'category' | 'search';

export interface StoreAdapter {
  id: string;

  /** Ce que ce magasin sait faire. Le moteur ne tente que le déclaré. */
  capabilities: {
    deals: boolean;      // peut lister les rabais en cours
    categories: boolean; // peut parcourir une catégorie
    search: boolean;     // peut répondre à une requête texte
  };

  /** Slugs canoniques que cet adaptateur sait parcourir. */
  categories?: string[];

  listDeals?(ctx: CrawlContext): AsyncGenerator<RawProduct>;
  listCategory?(slug: string, ctx: CrawlContext): AsyncGenerator<RawProduct>;
  search?(query: string, ctx: CrawlContext): AsyncGenerator<RawProduct>;
}

/**
 * Nature d'une source de prix. La distinction n'est pas cosmétique : les deux
 * types jouent des ROLES DIFFERENTS dans l'evaluation.
 *
 *  - 'retailer'     : un detaillant. Son prix est une OFFRE, a comparer aux
 *                     autres offres du meme produit.
 *
 *  - 'manufacturer' : le fabricant lui-meme (Apple, Dell, Samsung...). Son prix
 *                     n'est pas une offre concurrente, c'est le PRIX DE
 *                     REFERENCE. Publie par celui qui le fixe, il fait autorite
 *                     la ou un article de blog ne fait qu'approximer.
 *
 * Concretement : un MacBook a 1 099 $ chez Best Buy face aux 1 299 $ affiches
 * par Apple, c'est un rabais reel de 200 $, etabli sans aucun historique et
 * sans rien deviner.
 */
export type StoreKind = 'retailer' | 'manufacturer';

/** Métadonnées d'un magasin, connues même sans adaptateur (statut « à venir »). */
export interface StoreMeta {
  id: string;
  name: string;
  kind: StoreKind;
  country: string;
  currency: string;
  homepage: string;
  color: string;
  /** Débit maximal, en requêtes par seconde. Volontairement conservateur. */
  requestsPerSecond: number;
  adapter?: StoreAdapter;
}
