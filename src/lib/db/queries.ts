import { db } from './index';
import { FAMILY_LABEL, FAMILY_ORDER } from '../specs';
import { STORES } from '../scraping/registry';

/**
 * Couche d'accès aux données du site.
 *
 * Toutes les pages lisent la base déjà calculée : aucune agrégation lourde au
 * moment du rendu, aucune requête réseau. C'est tout l'intérêt du modèle
 * « crawl par lots » — l'affichage est instantané parce que le travail a été
 * fait en amont.
 */

export interface DealRow {
  id: number;
  title: string;
  brand: string | null;
  model: string | null;
  url: string;
  imageUrl: string | null;
  description: string | null;
  storeId: string;
  storeName: string;
  storeColor: string | null;
  categorySlug: string | null;
  condition: string;
  /** Baisse mesuree par nous : dans le temps, ou face aux equivalents. */
  verifiedDrop: number;
  /**
   * Note et volume d'avis EFFECTIVEMENT retenus par le score.
   *
   * Une unite boite ouverte porte ses propres 14 avis alors que le meme modele
   * en neuf en compte 44 : le moteur garde le plus grand echantillon. La fiche
   * doit montrer ce nombre-la, sans quoi trois chiffres differents apparaissent
   * sur le meme ecran sans qu'aucun ne soit faux.
   */
  qualityRating: number | null;
  qualityCount: number | null;
  availability: string;
  marketplace: number;
  sellerName: string | null;
  currency: string;
  price: number;
  listPrice: number | null;
  inStock: number | null;
  rating: number | null;
  ratingCount: number | null;
  score: number;
  confidence: number;
  dropVsMedian: number | null;
  isLowestEver: number;
  median: number | null;
  minEver: number | null;
  maxEver: number | null;
  daysOfHistory: number;
  reasons: string[];
  recommendYes: number | null;
  recommendTotal: number | null;
  reviews: ProductReview[];
}

export interface ProductReview {
  rating: number;
  comment: string;
  author: string | null;
  date: string | null;
  verified: boolean;
  helpful: number;
  incentivized: boolean;
}

const SELECT_DEAL = `
  SELECT p.id, p.title, p.brand, p.model, p.url, p.image_url AS imageUrl,
         p.description,
         p.store_id AS storeId, st.name AS storeName, st.color AS storeColor,
         p.category_slug AS categorySlug, p.condition, p.currency,
         p.availability, p.marketplace, p.seller_name AS sellerName,
         p.current_price AS price, p.list_price AS listPrice, p.in_stock AS inStock,
         p.rating, p.rating_count AS ratingCount,
         s.score, s.confidence, s.drop_vs_median AS dropVsMedian,
         s.is_lowest_ever AS isLowestEver, s.median_90d AS median,
         s.verified_drop AS verifiedDrop,
         s.quality_rating AS qualityRating, s.quality_count AS qualityCount,
         s.min_ever AS minEver, s.max_ever AS maxEver,
         s.days_of_history AS daysOfHistory, s.reasons,
         e.recommend_yes AS recommendYes, e.recommend_total AS recommendTotal,
         e.reviews AS reviewsJson
    FROM deal_scores s
    JOIN products p ON p.id = s.product_id
    JOIN stores   st ON st.id = p.store_id
    LEFT JOIN product_enrichment e ON e.product_id = p.id
`;

function hydrate(r: any): DealRow {
  return {
    ...r,
    reasons: safeParse(r.reasons),
    reviews: safeParseObjects<ProductReview>(r.reviewsJson),
  };
}

/** Comme safeParse, mais pour un tableau d'objets. */
function safeParseObjects<T>(json: string | null): T[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function safeParse(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export interface DealFilters {
  category?: string;
  store?: string;
  /**
   * 'new'  (défaut) : neuf uniquement
   * 'all'           : tous les états
   * 'used'          : UNIQUEMENT boîte ouverte et remis à neuf
   *
   * La valeur 'used' existe parce que filtrer APRÈS la requête ne marche pas :
   * demander les 10 meilleurs puis ne garder que les non-neufs laisse une liste
   * vide, les meilleurs scores étant presque toujours des articles neufs. Le
   * filtre doit vivre dans le SQL.
   */
  condition?: 'new' | 'all' | 'used';
  minScore?: number;
  minConfidence?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  /** Ne garder que les produits au plus bas prix observe. */
  lowestEverOnly?: boolean;
  limit?: number;
  offset?: number;
  sort?: 'score' | 'drop' | 'price-asc' | 'price-desc';

  /** Borne basse de prix. La borne haute existe deja sous `maxPrice`. */
  minPrice?: number;
  /** Afficher toutes les variantes d'un meme article, pas seulement une. */
  includeVariants?: boolean;
  /**
   * Enseignes retenues.
   *
   * Distinct de `store`, qui fixe le contexte d'une page entiere (« je suis
   * chez Canac »). Celui-ci est un filtre que l'utilisateur coche et decoche.
   */
  stores?: string[];
  /** Marques retenues, en minuscules. */
  brands?: string[];
  /** Vendeurs tiers retenus. */
  sellers?: string[];
  /**
   * Caracteristiques retenues, par famille : { cpu: ['processeur-core-i7'] }.
   *
   * Plusieurs valeurs dans une meme famille sont un OU (« i5 ou i7 ») ;
   * plusieurs familles sont un ET (« un i7 ET 32 Go »). C'est le comportement
   * attendu d'un panneau de filtres, et le seul qui ne se contredise pas.
   */
  specs?: Record<string, string[]>;
}


/**
 * IMPORTANT — les filtres portent sur `deal_scores`, pas sur `products`.
 *
 * Les colonnes is_active / condition / category_slug / store_id / price y sont
 * recopiées à chaque calcul de score, précisément pour que le filtrage ET le
 * tri tiennent dans un seul index. Filtrer sur `products` obligeait SQLite à
 * joindre 163 000 lignes puis à tout trier en mémoire
 * (« USE TEMP B-TREE FOR ORDER BY »), soit 220-330 ms par requête.
 */
/**
 * Conditions communes a la LISTE et a son COMPTEUR.
 *
 * Les deux les construisaient chacune de leur cote, et elles avaient diverge :
 * le compteur ignorait quatre filtres. La pagination annoncait alors un nombre
 * de resultats different de ce qu'elle affichait — un ecart invisible tant
 * qu'on ne compte pas soi-meme.
 *
 * `avecJointure` indique si la requete appelante joint `products` : le filtre
 * de disponibilite en depend, le compteur n'interrogeant que `deal_scores`.
 */
function dealClauses(
  f: DealFilters,
  avecJointure: boolean,
): { where: string[]; params: Record<string, unknown>; besoinProduits: boolean } {
  const where: string[] = ['s.is_active = 1'];
  const params: Record<string, unknown> = {};

  if (f.category) {
    // On accepte une catégorie racine et on descend d'un niveau, pour que
    // « Électronique » remonte aussi les téléviseurs et les casques.
    where.push(`(s.category_slug = @category
                 OR s.category_slug IN (SELECT slug FROM categories WHERE parent_slug = @category))`);
    params.category = f.category;
  }
  if (f.store) {
    where.push('s.store_id = @store');
    params.store = f.store;
  }
  if (f.stores?.length) {
    const cles = f.stores.map((v, i) => {
      params[`st${i}`] = v;
      return `@st${i}`;
    });
    where.push(`s.store_id IN (${cles.join(', ')})`);
  }
  if (f.condition === 'used') where.push("s.condition != 'new'");
  else if (f.condition !== 'all') where.push("s.condition = 'new'");
  if (f.inStockOnly && avecJointure) where.push('(p.in_stock IS NULL OR p.in_stock = 1)');
  if (f.lowestEverOnly) where.push('s.is_lowest_ever = 1');
  if (f.minScore !== undefined) {
    where.push('s.score >= @minScore');
    params.minScore = f.minScore;
  }
  if (f.minConfidence !== undefined) {
    where.push('s.confidence >= @minConfidence');
    params.minConfidence = f.minConfidence;
  }
  if (f.maxPrice !== undefined) {
    where.push('s.price <= @maxPrice');
    params.maxPrice = f.maxPrice;
  }

  // « Plus forte baisse » ne trie que ce qui EST une baisse.
  //
  // Sans ce seuil, la liste continuait avec des ecarts de quelques dixiemes de
  // pourcent — un dollar sur mille cinq cents — presentes comme des rabais. Un
  // produit sans baisse mesurable n'a rien a faire dans ce classement, meme en
  // vingtieme page.
  if (f.sort === 'drop') where.push('s.verified_drop >= 0.05');

  // UN representant par groupe de variantes.
  //
  // Sans ce filtre, une page de rayon pouvait afficher soixante-neuf bracelets
  // identiques au meme prix et repousser tout le reste hors ecran. Les autres
  // variantes restent cherchables et accessibles par leur adresse : elles sont
  // absentes du classement, pas du site.
  if (!f.includeVariants) where.push('s.is_variant_lead = 1');

  if (f.minPrice !== undefined) {
    where.push('s.price >= @minPrice');
    params.minPrice = f.minPrice;
  }

  // Marque et vendeur vivent sur `products` : la requete appelante doit alors
  // joindre cette table. On le signale plutot que de le supposer.
  let besoinProduits = false;

  if (f.brands?.length) {
    besoinProduits = true;
    const noms = f.brands.map((b, i) => {
      params[`brand${i}`] = b.toLowerCase();
      return `@brand${i}`;
    });
    where.push(`LOWER(p.brand) IN (${noms.join(', ')})`);
  }

  if (f.sellers?.length) {
    besoinProduits = true;
    const noms = f.sellers.map((v, i) => {
      params[`seller${i}`] = v;
      return `@seller${i}`;
    });
    where.push(`p.seller_name IN (${noms.join(', ')})`);
  }

  // Une sous-requete par famille : leur intersection realise le ET entre
  // familles, l'IN realisant le OU a l'interieur de chacune.
  let famille = 0;
  for (const [nom, valeurs] of Object.entries(f.specs ?? {})) {
    if (!valeurs.length) continue;
    const cleFamille = `spf${famille}`;
    params[cleFamille] = nom;
    const cles = valeurs.map((v, i) => {
      params[`spv${famille}_${i}`] = v;
      return `@spv${famille}_${i}`;
    });
    where.push(
      `s.product_id IN (SELECT product_id FROM product_specs
                         WHERE family = @${cleFamille} AND value IN (${cles.join(', ')}))`,
    );
    famille++;
  }

  return { where, params, besoinProduits };
}

/** Ordre SQL correspondant au tri demande. */
function dealOrder(sort: DealFilters['sort']): string {
  return sort === 'drop'
    ? 's.verified_drop DESC, s.score DESC'
    : sort === 'price-asc'
      ? 's.price ASC'
      : sort === 'price-desc'
        ? 's.price DESC'
        : 's.score DESC, s.confidence DESC';
}

export function topDeals(f: DealFilters = {}): DealRow[] {
  const { where, params } = dealClauses(f, true);

  params.limit = f.limit ?? 48;
  params.offset = f.offset ?? 0;

  return db()
    .prepare(
      `${SELECT_DEAL} WHERE ${where.join(' AND ')}
       ORDER BY ${dealOrder(f.sort)} LIMIT @limit OFFSET @offset`,
    )
    .all(params)
    .map(hydrate);
}

export function countDeals(f: DealFilters = {}): number {
  // Sans filtre sur la marque ou le vendeur, aucune jointure n'est necessaire :
  // tout est dans deal_scores, et l'index suffit.
  const { where, params, besoinProduits } = dealClauses(f, false);
  const jointure = besoinProduits ? 'JOIN products p ON p.id = s.product_id' : '';

  return (
    db()
      .prepare(`SELECT COUNT(*) n FROM deal_scores s ${jointure} WHERE ${where.join(' AND ')}`)
      .get(params) as { n: number }
  ).n;
}

/**
 * Recherche plein texte.
 *
 * FTS5 fournit la pertinence (BM25), mais la pertinence seule renverrait le
 * produit le mieux nommé, pas la meilleure affaire. On combine donc les deux :
 * la pertinence filtre, le score de deal départage.
 */
export function search(
  query: string,
  f: DealFilters = {},
): { rows: DealRow[]; total: number } {
  const match = toFtsQuery(query);
  if (!match) return { rows: [], total: 0 };

  const where = ['s.is_active = 1'];
  const params: Record<string, unknown> = { match };

  if (f.category) {
    where.push(`(s.category_slug = @category
                 OR s.category_slug IN (SELECT slug FROM categories WHERE parent_slug = @category))`);
    params.category = f.category;
  }
  if (f.store) {
    where.push('s.store_id = @store');
    params.store = f.store;
  }
  if (f.condition === 'used') where.push("s.condition != 'new'");
  else if (f.condition !== 'all') where.push("s.condition = 'new'");
  if (f.maxPrice !== undefined) {
    where.push('s.price <= @maxPrice');
    params.maxPrice = f.maxPrice;
  }

  const order =
    f.sort === 'price-asc'
      ? 's.price ASC'
      : f.sort === 'price-desc'
        ? 's.price DESC'
        : f.sort === 'drop'
          ? 's.verified_drop DESC'
          : // Par défaut : pertinence d'abord (bm25 est négatif, plus bas = mieux),
            // puis qualité de l'affaire.
            'bm25(products_fts) * 1.0 + (100 - s.score) * 0.06 ASC';

  params.limit = f.limit ?? 48;
  params.offset = f.offset ?? 0;

  try {
    const rows = db()
      .prepare(
        `${SELECT_DEAL}
           JOIN products_fts fts ON fts.rowid = p.id
          WHERE products_fts MATCH @match AND ${where.join(' AND ')}
          ORDER BY ${order} LIMIT @limit OFFSET @offset`,
      )
      .all(params)
      .map(hydrate);

    const total = (
      db()
        .prepare(
          `SELECT COUNT(*) n FROM products_fts fts
             JOIN deal_scores s ON s.product_id = fts.rowid
            WHERE products_fts MATCH @match AND ${where.join(' AND ')}`,
        )
        .get(params) as { n: number }
    ).n;

    return { rows, total };
  } catch {
    // Une requête FTS malformée ne doit jamais casser la page.
    return { rows: [], total: 0 };
  }
}

/**
 * Transforme une saisie libre en requête FTS5 sûre.
 *
 * Sans ça, une apostrophe ou un guillemet suffirait à provoquer une erreur de
 * syntaxe FTS. On ne garde que des mots, et on ajoute `*` sur le dernier pour
 * que la recherche fonctionne pendant la frappe (« telev » trouve
 * « téléviseur »).
 */
export function toFtsQuery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);

  if (tokens.length === 0) return null;

  return tokens
    .map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`))
    .join(' AND ');
}

export function getProduct(id: number): DealRow | null {
  const row = db()
    .prepare(`${SELECT_DEAL} WHERE p.id = ?`)
    .get(id);
  return row ? hydrate(row) : null;
}

export interface ManufacturerReference {
  price: number;
  notes: string | null;
  sources: string[];
  checkedAt: string;
}

/**
 * Prix officiel du fabricant, quand on a pu l'obtenir.
 *
 * C'est la seule reference qui ne vienne ni du marchand ni de nous : elle est
 * fixee par celui qui fabrique le produit. Un detaillant 200 $ en dessous fait
 * un vrai rabais de 200 $, etabli sans historique et sans supposition.
 *
 * Elle n'entre PAS dans la courbe de prix : ce n'est pas une observation dans
 * le temps, c'est un point d'ancrage. Melanger les deux ferait croire a un
 * releve que nous n'avons jamais fait.
 */
export function manufacturerReference(productId: number): ManufacturerReference | null {
  const r = db()
    .prepare<[number], {
      launch_price: number | null;
      notes: string | null;
      sources: string;
      checked_at: string;
    }>(
      `SELECT launch_price, notes, sources, checked_at
         FROM price_references
        WHERE product_id = ? AND found = 1 AND launch_price IS NOT NULL`,
    )
    .get(productId);

  if (!r?.launch_price) return null;

  let sources: string[] = [];
  try {
    const brut = JSON.parse(r.sources);
    if (Array.isArray(brut)) sources = brut.filter((x): x is string => typeof x === 'string');
  } catch {
    // Une provenance illisible ne doit pas empecher d'afficher le prix.
  }

  return { price: r.launch_price, notes: r.notes, sources, checkedAt: r.checked_at };
}

export interface HistoryPoint {
  price: number;
  listPrice: number | null;
  inStock: number | null;
  observedAt: string;
}

export function priceHistory(productId: number): HistoryPoint[] {
  return db()
    .prepare(
      `SELECT price, list_price AS listPrice, in_stock AS inStock, observed_at AS observedAt
         FROM price_points WHERE product_id = ? ORDER BY observed_at ASC`,
    )
    .all(productId) as HistoryPoint[];
}

/** Même modèle chez d'autres marchands — devient utile dès le 2e magasin. */
/** Meme normalisation que la colonne `model_key`, cote application. */
export const modelKeyOf = (model: string) =>
  model.toUpperCase().replace(/[-\s.]/g, '');

export function competingOffers(product: DealRow): DealRow[] {
  if (!product.model) return [];
  const key = modelKeyOf(product.model);

  // UN prix par marchand : le meilleur.
  //
  // Un meme modele apparait souvent plusieurs fois chez un marchand — vendeurs
  // tiers, lots, conditionnements. La fiche affichait alors deux lignes au
  // titre identique a 529,99 $ et 669,98 $, ce qui ressemble a une erreur. La
  // question posee est « combien ailleurs ? » : la reponse est le meilleur
  // prix de chaque enseigne.
  return db()
    .prepare(
      `${SELECT_DEAL}
        WHERE p.store_id != ? AND p.is_active = 1
          AND p.model_key = ?
          AND p.current_price = (
            SELECT MIN(q.current_price) FROM products q
             WHERE q.store_id = p.store_id AND q.is_active = 1 AND q.model_key = ?
          )
        GROUP BY p.store_id
        ORDER BY p.current_price ASC LIMIT 6`,
    )
    .all(product.storeId, key, key)
    .map(hydrate);
}

/**
 * Meilleurs produits du MÊME groupe de pairs, à qualité supérieure.
 *
 * Répond à la question que l'on se pose vraiment devant une fiche : « et si je
 * mettais un peu plus cher ? ». On reste dans le groupe de pairs plutôt que
 * dans la catégorie entière : proposer un téléviseur 85 po à quelqu'un qui
 * regarde un 43 po n'aide personne.
 */
export function betterAlternatives(product: DealRow, limit = 4): DealRow[] {
  const key = db()
    .prepare<[number], { peer_key: string | null; quality_score: number | null }>(
      'SELECT peer_key, quality_score FROM deal_scores WHERE product_id = ?',
    )
    .get(product.id);

  if (!key?.peer_key) return [];

  return db()
    .prepare(
      `${SELECT_DEAL}
        WHERE s.peer_key = @key
          AND s.is_active = 1
          AND s.product_id != @id
          AND s.quality_score > @quality
          AND s.price <= @maxPrice
        ORDER BY s.quality_score DESC, s.score DESC
        LIMIT @limit`,
    )
    .all({
      key: key.peer_key,
      id: product.id,
      quality: (key.quality_score ?? 0) + 0.05,
      // Au-delà du double du prix regardé, ce n'est plus une alternative.
      maxPrice: product.price * 2,
      limit,
    })
    .map(hydrate);
}


export interface Suggestion {
  /** Texte affiché, et inséré dans la barre pour les suggestions textuelles. */
  value: string;
  /** Nature de la suggestion, pour l'affichage. */
  kind: 'marque' | 'categorie' | 'produit';
  /** Contexte affiché à droite (nombre de produits, catégorie…). */
  hint?: string;
  /**
   * Destination directe, quand la suggestion désigne une chose précise.
   *
   * Sans cela, cliquer sur un produit relançait une RECHERCHE sur son titre
   * tronqué — qui, avec ses points de suspension, ne trouvait rien du tout.
   * Proposer un choix qui mène à une page vide est pire que ne rien proposer.
   */
  href?: string;
}

/**
 * Suggestions de recherche à la frappe.
 *
 * Trois natures, dans cet ordre de priorité — le même choix que fait un moteur
 * de recherche : d'abord les ENTITÉS (une marque, un rayon), qui mènent à un
 * ensemble cohérent de résultats ; ensuite les produits précis.
 *
 * On complète le dernier mot par un préfixe (`"telev"*` trouve « téléviseur »),
 * ce qui permet de proposer quelque chose dès la troisième lettre, avant même
 * que le mot soit fini.
 */
/**
 * Listes de marques et de catégories, gardées en mémoire.
 *
 * Elles ne changent qu'après un crawl, mais les recalculer coûtait un
 * `GROUP BY` sur 202 000 lignes À CHAQUE FRAPPE — soit 200 ms par appel, la
 * cause principale du manque de réactivité de la barre de recherche.
 *
 * Le cache expire après quelques minutes : assez pour absorber une session de
 * frappe entière, assez court pour qu'un nouveau crawl se voie rapidement.
 */
const CACHE_TTL_MS = 5 * 60_000;

let facetCache: {
  expires: number;
  brands: Array<{ name: string; norm: string; n: number }>;
  categories: Array<{ name: string; slug: string; words: string[]; n: number }>;
} | null = null;

const stripAccents = (x: string) =>
  x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function facets() {
  if (facetCache && facetCache.expires > Date.now()) return facetCache;
  const conn = db();

  const brands = conn
    .prepare<[], { brand: string; n: number }>(
      `SELECT p.brand, COUNT(*) n
         FROM products p
        WHERE p.is_active = 1 AND p.brand IS NOT NULL
        GROUP BY LOWER(p.brand) ORDER BY n DESC`,
    )
    .all()
    .map((b) => ({ name: b.brand, norm: stripAccents(b.brand), n: b.n }));

  const categories = conn
    .prepare<[], { name: string; slug: string; n: number }>(
      `SELECT c.name, c.slug, COUNT(s.product_id) n
         FROM categories c
         JOIN deal_scores s ON s.category_slug = c.slug AND s.is_active = 1
        GROUP BY c.slug ORDER BY n DESC`,
    )
    .all()
    .map((c) => ({
      name: c.name,
      slug: c.slug,
      words: stripAccents(c.name).split(/[^a-z0-9]+/).filter(Boolean),
      n: c.n,
    }));

  facetCache = { expires: Date.now() + CACHE_TTL_MS, brands, categories };
  return facetCache;
}

export interface FacetValue {
  label: string;
  value: string;
  count: number;
  metric: number | null;
}

export interface SpecFacet {
  family: string;
  label: string;
  values: FacetValue[];
}

export interface CategoryFacets {
  priceMin: number;
  priceMax: number;
  brands: FacetValue[];
  sellers: FacetValue[];
  specs: SpecFacet[];
  /** Enseignes presentes dans cette selection, avec leur nombre d'articles. */
  storeFacets: FacetValue[];
}

/**
 * Choix de filtres REELLEMENT disponibles dans une categorie.
 *
 * Les facettes sont calculees sur le contenu, jamais ecrites a la main : un
 * rayon d'ordinateurs propose le processeur et la memoire, un rayon de
 * refrigerateurs propose la capacite et le niveau sonore. Aucune liste figee ne
 * resterait juste, et proposer un filtre qui ne renvoie rien est pire que de
 * ne pas le proposer.
 *
 * Une valeur qui ne concerne qu'un ou deux produits est ecartee : elle
 * encombre le panneau sans jamais servir a trier.
 */
const MIN_FACET_COUNT = 3;

/** Au-dela, un panneau devient une liste a parcourir plutot qu'un filtre. */
const MAX_FACET_VALUES = 12;

let categoryFacetCache = new Map<string, { expires: number; data: CategoryFacets }>();

export function invalidateFacetCache() {
  categoryFacetCache = new Map();
}

/**
 * Facettes disponibles, en tenant compte des filtres DEJA poses.
 *
 * Le piege classique du filtrage a facettes : une fois « Core i7 » coche, si on
 * recompte tout avec ce filtre applique, les autres processeurs tombent a zero
 * et disparaissent. L'utilisateur ne peut plus changer d'avis sans tout
 * effacer.
 *
 * La regle correcte est connue : pour compter les valeurs d'un critere, on
 * applique tous les filtres SAUF celui-la. Un critere non filtre n'a pas besoin
 * de ce traitement, d'ou une requete de base plus une par critere filtre —
 * rarement plus de trois en pratique.
 */
export function categoryFacets(f: DealFilters = {}): CategoryFacets {
  const filtresActifs =
    Object.values(f.specs ?? {}).some((v) => v.length) ||
    Boolean(f.brands?.length || f.sellers?.length || f.minPrice || f.maxPrice);

  const cle = `${f.category ?? '*'}|${f.condition ?? 'new'}`;
  if (!filtresActifs) {
    const enCache = categoryFacetCache.get(cle);
    if (enCache && enCache.expires > Date.now()) return enCache.data;
  }

  const conn = db();

  /** Requete de facettes de caracteristiques, sous un jeu de filtres donne. */
  const compter = (filtres: DealFilters) => {
    const { where, params } = dealClauses(filtres, true);
    return conn
      .prepare<
        Record<string, unknown>,
        { family: string; label: string; value: string; metric: number | null; count: number }
      >(
        `SELECT ps.family, ps.label, ps.value, ps.metric, COUNT(*) AS count
           FROM product_specs ps
           JOIN deal_scores s ON s.product_id = ps.product_id
           JOIN products p ON p.id = s.product_id
          WHERE ${where.join(' AND ')}
          GROUP BY ps.family, ps.value
         HAVING count >= ${MIN_FACET_COUNT}
          ORDER BY count DESC`,
      )
      .all(params);
  };

  const parFamille = new Map<string, FacetValue[]>();
  const ajouter = (
    lignes: Array<{ family: string; label: string; value: string; metric: number | null; count: number }>,
    seulement?: string,
  ) => {
    for (const r of lignes) {
      if (seulement && r.family !== seulement) continue;
      const liste = parFamille.get(r.family) ?? [];
      if (liste.length < MAX_FACET_VALUES) {
        liste.push({ label: r.label, value: r.value, count: r.count, metric: r.metric });
      }
      parFamille.set(r.family, liste);
    }
  };

  ajouter(compter(f));

  // Pour chaque critere filtre, on recompte SANS lui : sinon ses autres valeurs
  // auraient disparu et le choix serait irreversible.
  for (const [famille, valeurs] of Object.entries(f.specs ?? {})) {
    if (!valeurs.length) continue;
    const sansCeCritere = { ...f.specs };
    delete sansCeCritere[famille];
    parFamille.delete(famille);
    ajouter(compter({ ...f, specs: sansCeCritere }), famille);
  }

  const specs: SpecFacet[] = [];
  for (const family of FAMILY_ORDER) {
    const valeurs = parFamille.get(family);
    // Une seule valeur possible ne filtre rien : tous les produits la portent.
    if (!valeurs || valeurs.length < 2) continue;

    // Les valeurs chiffrees se lisent dans l'ordre des nombres (8, 16, 32) ;
    // les autres par frequence, le choix courant d'abord.
    const triees = valeurs.every((v) => v.metric !== null)
      ? [...valeurs].sort((a, b) => (a.metric ?? 0) - (b.metric ?? 0))
      : valeurs;

    specs.push({ family, label: FAMILY_LABEL[family] ?? family, values: triees });
  }

  // Marque et vendeur suivent la meme regle : comptes sans leur propre filtre.
  const clausesMarque = dealClauses({ ...f, brands: undefined }, true);
  const brands = conn
    .prepare<Record<string, unknown>, { label: string; value: string; count: number }>(
      `SELECT p.brand AS label, LOWER(p.brand) AS value, COUNT(*) AS count
         FROM deal_scores s JOIN products p ON p.id = s.product_id
        WHERE ${clausesMarque.where.join(' AND ')} AND p.brand IS NOT NULL AND p.brand <> ''
        GROUP BY LOWER(p.brand)
       HAVING count >= ${MIN_FACET_COUNT}
        ORDER BY count DESC LIMIT ${MAX_FACET_VALUES * 2}`,
    )
    .all(clausesMarque.params)
    .map((r) => ({ ...r, metric: null }));

  const clausesVendeur = dealClauses({ ...f, sellers: undefined }, true);
  const sellers = conn
    .prepare<Record<string, unknown>, { label: string; value: string; count: number }>(
      `SELECT p.seller_name AS label, p.seller_name AS value, COUNT(*) AS count
         FROM deal_scores s JOIN products p ON p.id = s.product_id
        WHERE ${clausesVendeur.where.join(' AND ')} AND p.seller_name IS NOT NULL
        GROUP BY p.seller_name
       HAVING count >= ${MIN_FACET_COUNT}
        ORDER BY count DESC LIMIT ${MAX_FACET_VALUES}`,
    )
    .all(clausesVendeur.params)
    .map((r) => ({ ...r, metric: null }));

  // Les bornes de prix ignorent le filtre de prix : elles decrivent le rayon,
  // pas la selection en cours. Sinon le curseur se retrecirait a chaque essai.
  const clausesPrix = dealClauses({ ...f, minPrice: undefined, maxPrice: undefined }, true);
  const bornes = conn
    .prepare<Record<string, unknown>, { mini: number | null; maxi: number | null }>(
      `SELECT MIN(s.price) mini, MAX(s.price) maxi
         FROM deal_scores s JOIN products p ON p.id = s.product_id
        WHERE ${clausesPrix.where.join(' AND ')}`,
    )
    .get(clausesPrix.params);

  // Les enseignes se comptent sans leur propre filtre, comme les autres
  // criteres : sinon cocher « Brick » ferait disparaitre « Best Buy » de la
  // liste, et le choix deviendrait irreversible.
  const clausesMagasin = dealClauses({ ...f, stores: undefined }, true);
  const storeFacets = conn
    .prepare<Record<string, unknown>, { label: string; value: string; count: number }>(
      `SELECT st.name AS label, st.id AS value, COUNT(*) AS count
         FROM deal_scores s
         JOIN products p ON p.id = s.product_id
         JOIN stores st ON st.id = s.store_id
        WHERE ${clausesMagasin.where.join(' AND ')}
        GROUP BY st.id
        ORDER BY count DESC`,
    )
    .all(clausesMagasin.params)
    .map((r) => ({ ...r, metric: null }));

  const data: CategoryFacets = {
    priceMin: Math.floor(bornes?.mini ?? 0),
    priceMax: Math.ceil(bornes?.maxi ?? 0),
    brands,
    sellers,
    specs,
    storeFacets,
  };

  if (!filtresActifs) {
    categoryFacetCache.set(cle, { expires: Date.now() + CACHE_TTL_MS, data });
  }
  return data;
}

export function suggest(raw: string, limit = 4): Suggestion[] {
  const query = raw.trim().toLowerCase();
  if (query.length < 2) return [];

  const conn = db();
  const out: Suggestion[] = [];
  const seen = new Set<string>();

  /**
   * Deux titres marchands qui commencent pareil décrivent presque toujours des
   * déclinaisons du même produit. Proposer « Casque Bluetooth à suppression du
   * bruit… » trois fois de suite n'aide personne : on déduplique donc sur le
   * DÉBUT du libellé, pas sur son texte complet.
   */
  const dedupeKey = (v: string) =>
    v
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]/g, '')
      .slice(0, 34);

  const add = (s: Suggestion) => {
    const key = dedupeKey(s.value);
    if (seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push(s);
  };

  // L'appariement se fait en JavaScript, pas en SQL : le LIKE de SQLite
  // n'ignore pas les accents, donc « telev » ne trouvait jamais « Téléviseurs ».
  // Les volumes concernés (94 catégories, quelques milliers de marques) rendent
  // le filtrage en mémoire immédiat, là où le corriger en SQL demanderait une
  // colonne normalisée supplémentaire.
  const needle = stripAccents(query);

  // 1. Marques — la suggestion la plus utile : elle mène à un ensemble entier.
  for (const b of facets().brands.filter((x) => x.norm.startsWith(needle)).slice(0, 2)) {
    add({ value: b.name, kind: 'marque', hint: `${b.n} produits` });
  }

  // 2. Catégories dont un MOT commence par la saisie.
  //
  // Avec une correspondance « n'importe où dans le texte », taper « air »
  // proposait « Luminaires » : le mot contient bien ces trois lettres, mais
  // personne ne cherche ça.
  for (const c of facets()
    .categories.filter((x) => x.words.some((w) => w.startsWith(needle)))
    .slice(0, 1)) {
    add({
      value: c.name,
      kind: 'categorie',
      hint: `${c.n} produits`,
      href: `/categories/${c.slug}`,
    });
  }

  // 3. Produits — on complète le dernier mot, pour suggérer pendant la frappe.
  const candidats: Array<{ rang: number; suggestion: Suggestion }> = [];
  const match = toFtsQuery(query);
  if (match) {
    try {
      for (const p of conn
        .prepare<
          [string, number],
          {
            id: number;
            title: string;
            brand: string | null;
            model: string | null;
            category: string | null;
          }
        >(
          `SELECT p.id, p.title, p.brand, p.model, c.name AS category
             FROM products_fts fts
             JOIN deal_scores s ON s.product_id = fts.rowid AND s.is_active = 1
             JOIN products p ON p.id = fts.rowid
             LEFT JOIN categories c ON c.slug = s.category_slug
            WHERE products_fts MATCH ?
            -- PERTINENCE d'abord, pas score de deal.
            --
            -- Trier le vivier par score de bonne affaire laissait les 167
            -- AirPods du catalogue hors des 100 premiers résultats : ils
            -- n'atteignaient jamais l'étape de classement. Pour une
            -- autocomplétion, ce qui compte est la proximité au texte tapé ;
            -- la qualité de l'affaire départage ensuite.
            ORDER BY bm25(products_fts) ASC LIMIT ?`,
        )
        .all(match, limit * 25)) {
        // Les titres marchands sont longs ; on garde la tête, qui porte le sens.
        // Le libellé doit DISTINGUER, pas décrire.
        //
        // Les titres marchands commencent tous pareil : chercher « aw3225 »
        // renvoyait huit lignes « Boîte ouverte - Moniteur de jeu… », visuellement
        // identiques et sans rapport apparent avec la saisie. Quand on connaît la
        // marque et le modèle, on les met en tête : c'est ce qui identifie
        // réellement l'article.
        const identite = [p.brand, p.model].filter(Boolean).join(' ');
        const reste = p.title.length > 44 ? `${p.title.slice(0, 44).trimEnd()}…` : p.title;
        const libelle = identite ? `${identite} — ${reste}` : reste;

        // CLASSEMENT — le cœur d'une bonne autocomplétion.
        //
        // Taper « air » et obtenir « friteuse à air », c'est un mot qui ÉGALE
        // la saisie. Obtenir « AirPods », c'est un mot que la saisie COMPLÈTE.
        // Une autocomplétion prolonge ce qu'on écrit ; elle ne répète pas un
        // mot entier. On classe donc :
        //
        //   0 — la saisie ouvre le libellé (« Samsung… » pour « sams »)
        //   1 — la saisie allonge un mot ailleurs (« AirPods » pour « air »)
        //   2 — la saisie égale un mot entier (« à air » pour « air »)
        //
        // Sans cette distinction, les 167 AirPods du catalogue restaient
        // invisibles derrière des friteuses.
        const cible = stripAccents(`${identite} ${p.title}`);
        const mots = cible.split(/[^a-z0-9]+/).filter(Boolean);

        const rang = cible.startsWith(needle)
          ? 0
          : mots.some((m) => m.startsWith(needle) && m.length > needle.length)
            ? 1
            : 2;

        candidats.push({
          rang,
          suggestion: {
            value: libelle,
            kind: 'produit' as const,
            hint: p.category ?? undefined,
            href: `/produit/${p.id}`,
          },
        });
      }
    } catch {
      // Une requête FTS malformée ne doit jamais casser la saisie.
    }
  }

  // Les correspondances en début de libellé d'abord, l'ordre de pertinence
  // FTS ensuite — un tri stable préserve ce second critère.
  for (const c of candidats.sort((a, b) => a.rang - b.rang)) add(c.suggestion);

  return out;
}


export interface CategoryRank {
  /** Rang du produit dans sa catégorie, 1 = meilleur score. */
  rank: number;
  /** Nombre de produits classés dans cette catégorie. */
  total: number;
  categoryName: string;
  /** Les mieux classés de la catégorie, pour situer le produit. */
  leaders: Array<{ id: number; title: string; price: number; score: number }>;
}

/**
 * Position du produit dans sa catégorie, PAR QUALITÉ.
 *
 * Le classement porte sur `quality_score` — la borne de Wilson sur les avis
 * clients — et non sur notre score de bonne affaire.
 *
 * La distinction est essentielle. « 45e sur 2 371 » calculé sur le score de
 * deal répondait à « est-ce bien soldé aujourd'hui ? », une information déjà
 * portée par le score affiché juste au-dessus. Ce qu'on veut savoir ici est
 * différent et durable : **ce produit est-il bon ?** Un excellent moniteur au
 * prix fort reste un excellent moniteur ; un médiocre en liquidation reste
 * médiocre.
 *
 * Quand le produit fait DÉJÀ partie des premiers, on montre les autres membres
 * du podium plutôt que de le lister lui-même — se voir proposer ce qu'on
 * regarde déjà n'apprend rien.
 */
export function categoryRank(product: DealRow): CategoryRank | null {
  if (!product.categorySlug) return null;
  const conn = db();

  const qualite = conn
    .prepare<[number], { q: number | null }>(
      'SELECT quality_score q FROM deal_scores WHERE product_id = ?',
    )
    .get(product.id)?.q;

  // Sans évaluation, le produit n'a pas sa place dans un classement de qualité :
  // le placer arbitrairement serait pire que de ne rien dire.
  if (qualite == null) return null;

  // Seuls les produits RÉELLEMENT évalués entrent au classement. Compter ceux
  // dont on ignore la qualité gonflerait le total et rendrait le rang flatteur.
  const meilleurs = conn
    .prepare<[string, number], { n: number }>(
      `SELECT COUNT(*) n FROM deal_scores
        WHERE is_active = 1 AND category_slug = ?
          AND quality_score IS NOT NULL AND quality_score > ?`,
    )
    .get(product.categorySlug, qualite)!.n;

  const total = conn
    .prepare<[string], { n: number }>(
      `SELECT COUNT(*) n FROM deal_scores
        WHERE is_active = 1 AND category_slug = ? AND quality_score IS NOT NULL`,
    )
    .get(product.categorySlug)!.n;

  if (total < 5) return null;

  const leaders = conn
    .prepare<
      [string, number],
      { id: number; title: string; price: number; score: number }
    >(
      `SELECT s.product_id AS id, p.title, s.price, ROUND(s.quality_score * 100) AS score
         FROM deal_scores s JOIN products p ON p.id = s.product_id
        WHERE s.is_active = 1 AND s.category_slug = ?
          AND s.product_id != ? AND s.quality_score IS NOT NULL
          -- Une qualité estimée sur trop peu d'avis ne mérite pas la tête du
          -- classement : on exige une preuve réelle.
          AND COALESCE(p.rating_count, 0) >= 20
        ORDER BY s.quality_score DESC, p.rating_count DESC LIMIT 3`,
    )
    .all(product.categorySlug, product.id);

  return {
    rank: meilleurs + 1,
    total,
    categoryName: categoryNameOf(product.categorySlug),
    leaders,
  };
}

function categoryNameOf(slug: string): string {
  const r = db()
    .prepare<[string], { name: string }>('SELECT name FROM categories WHERE slug = ?')
    .get(slug);
  return r?.name ?? slug;
}

/**
 * Face-à-face avec des produits AU MOINS AUSSI BONS, du moins cher au plus cher.
 *
 * Une première version retenait les articles les plus proches en PRIX. C'était
 * la mauvaise question : savoir qu'un produit voisin coûte le même prix
 * n'apprend rien sur le rapport qualité-prix.
 *
 * La question utile est l'inverse : **combien coûte quelque chose d'au moins
 * aussi bon ?** Si un modèle mieux noté se vend moins cher, la réponse saute
 * aux yeux ; s'il faut payer 300 $ de plus pour un gain de qualité minime, elle
 * saute tout autant.
 *
 * On reste dans le même groupe de pairs — même format, mêmes caractéristiques
 * déterminantes — pour que la comparaison porte sur des articles réellement
 * substituables.
 */
export function comparables(product: DealRow, limit = 3): DealRow[] {
  const own = db()
    .prepare<[number], { peer_key: string | null; quality_score: number | null }>(
      'SELECT peer_key, quality_score FROM deal_scores WHERE product_id = ?',
    )
    .get(product.id);

  if (!own?.peer_key) return [];

  return db()
    .prepare(
      `${SELECT_DEAL}
        WHERE s.peer_key = @key
          AND s.is_active = 1
          AND s.product_id != @id
          -- Au moins aussi bon : une marge de 2 points absorbe le bruit
          -- d'estimation sans laisser passer de produit franchement inférieur.
          AND s.quality_score >= @quality
        ORDER BY s.price ASC
        LIMIT @limit`,
    )
    .all({
      key: own.peer_key,
      id: product.id,
      quality: (own.quality_score ?? 0) - 0.02,
      limit,
    })
    .map(hydrate);
}

export interface CategoryCount {
  slug: string;
  name: string;
  parentSlug: string | null;
  icon: string | null;
  count: number;
  bestScore: number | null;
}

/**
 * Catégories effectivement peuplées, avec leur volume et leur meilleur deal.
 *
 * L'agrégation se fait sur `deal_scores` seul, via l'index de catégorie. Une
 * version antérieure joignait `products` puis `deal_scores` avant de grouper —
 * correct, mais 110 ms sur un catalogue de 200 000 lignes, payés sur deux pages
 * du site.
 */
/**
 * Cache de l'arbre des categories.
 *
 * Ce comptage agrege 330 000 lignes : 150 ms, sur une donnee qui ne bouge
 * qu'apres une collecte. Il apparait sur l'accueil, sur chaque rayon et sur
 * chaque page de magasin — soit trois fois le meme travail par visite.
 */
let cacheCategories = new Map<string, { expires: number; data: CategoryCount[] }>();

export function invalidateCategoryCache() {
  cacheCategories = new Map();
}

export function categoriesWithCounts(storeId?: string): CategoryCount[] {
  const cle = storeId ?? '*';
  const enCache = cacheCategories.get(cle);
  if (enCache && enCache.expires > Date.now()) return enCache.data;
  // Restreint a une enseigne quand on demande « que vend Canac ? ». Sans
  // argument, le comportement reste celui du catalogue entier.
  const lignes = db()
    .prepare(
      `WITH totaux AS (
         SELECT category_slug AS slug,
                COUNT(*)      AS count,
                MAX(score)    AS bestScore
           FROM deal_scores
          WHERE is_active = 1 AND category_slug IS NOT NULL
            AND (@store IS NULL OR store_id = @store)
          GROUP BY category_slug
       )
       SELECT c.slug, c.name, c.parent_slug AS parentSlug, c.icon,
              COALESCE(t.count, 0)              AS count,
              ROUND(t.bestScore, 1)             AS bestScore
         FROM categories c
         LEFT JOIN totaux t ON t.slug = c.slug
        ORDER BY c.sort_order`,
    )
    .all({ store: storeId ?? null }) as CategoryCount[];

  cacheCategories.set(cle, { expires: Date.now() + CACHE_TTL_MS, data: lignes });
  return lignes;
}

export interface SiteStats {
  products: number;
  stores: number;
  pricePoints: number;
  lastCrawl: string | null;
  lowestEver: number;
}

export function siteStats(): SiteStats {
  const c = db();
  // Les compteurs passent par deal_scores : ses colonnes dénormalisées sont
  // indexées, alors qu'un COUNT sur products impose un balayage complet.
  const p = c
    .prepare('SELECT COUNT(*) n FROM deal_scores WHERE is_active = 1')
    .get() as { n: number };
  const st = c
    .prepare('SELECT COUNT(DISTINCT store_id) n FROM deal_scores WHERE is_active = 1')
    .get() as { n: number };
  const pp = c.prepare('SELECT COUNT(*) n FROM price_points').get() as { n: number };
  const last = c
    .prepare("SELECT MAX(finished_at) t FROM crawl_runs WHERE status IN ('ok','partial')")
    .get() as { t: string | null };
  const low = c
    .prepare('SELECT COUNT(*) n FROM deal_scores WHERE is_active = 1 AND is_lowest_ever = 1')
    .get() as { n: number };

  return {
    products: p.n,
    stores: st.n,
    pricePoints: pp.n,
    lastCrawl: last.t,
    lowestEver: low.n,
  };
}

export interface StoreRow {
  id: string;
  name: string;
  color: string | null;
  homepage: string;
  enabled: number;
  products: number;
  /** Le marchand refuse la collecte, et pourquoi. */
  blocked: string | null;
  /** Un adaptateur existe : la collecte est possible, faite ou a faire. */
  ready: boolean;
}

/**
 * Les enseignes, avec leur etat REEL.
 *
 * Trois etats distincts, et il faut les distinguer : une enseigne collectee,
 * une enseigne qui attend son adaptateur, et une enseigne qui nous refuse
 * l'acces. Annoncer « bientot disponible » sur la troisieme serait une
 * promesse qu'on ne peut pas tenir.
 */
export function activeStores(): StoreRow[] {
  const compte = db()
    .prepare<[], { id: string; products: number }>(
      `SELECT st.id, COUNT(p.id) AS products
         FROM stores st
         LEFT JOIN products p ON p.store_id = st.id AND p.is_active = 1
        GROUP BY st.id`,
    )
    .all();
  const parId = new Map(compte.map((r) => [r.id, r.products]));

  return STORES.map((st) => ({
    id: st.id,
    name: st.name,
    color: st.color,
    homepage: st.homepage,
    enabled: 1,
    products: parId.get(st.id) ?? 0,
    blocked: st.blocked ?? null,
    ready: Boolean(st.adapter),
  })).sort(
    (a, b) =>
      b.products - a.products ||
      Number(b.ready) - Number(a.ready) ||
      Number(Boolean(a.blocked)) - Number(Boolean(b.blocked)) ||
      a.name.localeCompare(b.name, 'fr'),
  );
}
