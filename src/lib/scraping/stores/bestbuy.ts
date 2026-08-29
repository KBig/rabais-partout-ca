import type {
  StoreAdapter,
  RawProduct,
  CrawlContext,
  ProductCondition,
} from '../types';

/**
 * Best Buy Canada.
 *
 * Best Buy expose une API JSON interne propre et stable :
 *   - /api/v2/json/search?categoryid=X&page=N&pageSize=100  -> listing paginé
 *   - /api/v2/json/category/X                               -> arbre de rayons
 *
 * Tout ce dont on a besoin (prix, prix régulier, note, nombre d'avis, image)
 * arrive dans le listing. Aucune requête par produit n'est nécessaire, ce qui
 * rend ce magasin très économe : ~19 appels pour 1 900 téléviseurs.
 */

const BASE = 'https://www.bestbuy.ca';
const PAGE_SIZE = 100;

/**
 * Correspondance rayon Best Buy -> slug canonique.
 * IDs relevés et vérifiés directement sur l'API (certains sont alphabétiques).
 * Un slug peut pointer vers plusieurs rayons ; on déduplique par SKU au crawl.
 */
export const CATEGORY_MAP: Record<string, string[]> = {
  televiseurs: ['21344'],
  audio: ['20303', '23997', '12521201'],
  casques: ['21268'],
  cameras: ['20005'],
  'maison-intelligente': ['30438'],

  portables: ['20352'],
  ordinateurs: ['20213'],
  moniteurs: ['20367'],
  composants: ['20374'],
  stockage: ['20232'],
  imprimantes: ['20330'],
  reseau: ['21099'],

  // Les telephones avec forfait sont affiches a 1 $ ou 0 $ : ce ne sont pas
  // des prix comparables a ceux des appareils deverrouilles. Les melanger
  // creait des groupes de pairs allant de 1 $ a 1 580 $.
  telephones: ['743355'],
  'telephones-forfait': ['696304', '743456'],
  tablettes: ['30297'],
  montres: ['34444'],

  'jeux-video': ['26516'],
  playstation: ['621715'],
  nintendo: ['621915'],
  xbox: ['621746'],
  'pc-gaming': ['21132'],
  'realite-virtuelle': ['1269307'],

  'gros-electro': ['11962778'],
  'petits-electro': ['26522', '20363'],
  aspirateurs: ['21372'],

  cuisine: ['30501'],
  literie: ['29937'],
  rangement: ['12110886'],
  luminaires: ['32447'],
  decoration: ['31700'],
  meubles: ['furniture'],
  salon: ['salon'],
  chambre: ['bedroom'],
  'salle-a-manger': ['33448'],
  'bureau-meubles': ['bureau'],

  outils: ['31699'],
  jardinage: ['29757'],

  jouets: ['21361'],
  lego: ['629277'],
  'jeux-societe': ['22104'],
  'jouets-enfants': ['22519066'],
  'jouets-exterieur': ['317241'],
  modelisme: ['35946', '22102'],

  fitness: ['882185'],
  sport: ['sportsrecreation'],

  mode: ['10159983'],
  bijoux: ['33198'],
  'montres-mode': ['32497'],
  'accessoires-mode': ['34420'],
  vetements: ['10160017', '10160020'],
  bagages: ['31698'],

  'beaute-sante': ['882186'],
  'beaute-corps': ['882187'],
  'soins-cheveux': ['34674', '27130'],
  'soins-dentaires': ['34675'],
  massage: ['33191'],
  'bien-etre': ['34684'],

  bebe: ['881392'],
  poussettes: ['34587'],
  'mobilier-bebe': ['34620', '623581'],
  'alimentation-bebe': ['32203'],
  'moniteurs-bebe': ['34609', '32200'],

  animaux: ['31702'],
  'habitat-animaux': ['36808'],
  'alimentation-animaux': ['36812'],
  'toilettage-animaux': ['36809'],
  'accessoires-animaux': ['36938', '36953'],

  bureau: ['30957'],
  'encre-toner': ['30958'],
  papeterie: ['447212', '35329'],
  'rangement-bureau': ['35328'],
  papier: ['30959'],

  auto: ['20004'],
  'pieces-auto': ['484639'],
  'audio-auto': ['20098'],
  'cameras-auto': ['484597'],
  'accessoires-auto': ['18717400'],
  gps: ['25133'],
};

/** Rayons parcourus par la stratégie « deals » : gros volume, fort taux de rabais. */
const DEALS_CATEGORIES = [
  'televiseurs',
  'portables',
  'casques',
  'audio',
  'playstation',
  'nintendo',
  'petits-electro',
  'aspirateurs',
  'moniteurs',
  'montres',
  'cameras',
];

interface BbProduct {
  sku: string;
  name: string;
  shortDescription?: string | null;
  productUrl: string;
  salePrice: number;
  regularPrice: number;
  customerRating?: number | null;
  customerRatingCount?: number | null;
  highResImage?: string | null;
  thumbnailImage?: string | null;
  categoryName?: string | null;
  isVisible?: boolean;
  isPreorderable?: boolean;
  isOnlineOnly?: boolean;
  isInStoreOnly?: boolean;
  isMarketplace?: boolean;
  seller?: { id?: string; name?: string } | null;
}

interface BbSearchResponse {
  currentPage: number;
  totalPages: number;
  total: number;
  products: BbProduct[];
}

/**
 * Les titres Best Buy portent le numéro de modèle entre parenthèses, ex :
 * "...de 24 po d Insignia (NS-24F201CA26) - 2025". On le récupère : c'est la
 * clé la plus fiable pour rapprocher le même produit entre deux magasins.
 */
function extractModel(name: string): string | null {
  const m = name.match(/\(([A-Z0-9][A-Z0-9._\-\/]{3,})\)/i);
  return m ? m[1] : null;
}

/**
 * Best Buy ne fournit pas de champ « etat » : l'information vit dans le titre,
 * en francais comme en anglais selon le produit.
 *
 * On DEPOUILLE LES ACCENTS avant de tester, au lieu d'enumerer les variantes.
 * Une premiere version cherchait litteralement « boite ouverte » et laissait
 * donc passer « Boite ouverte » ecrit avec un accent circonflexe — des produits
 * en boite ouverte se retrouvaient etiquetes neufs et passaient le filtre.
 * Normaliser une fois vaut mieux que multiplier les cas particuliers.
 */
function detectCondition(name: string): ProductCondition {
  const n = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // depouille les diacritiques

  if (/boite ouverte|open box|open-box/.test(n)) return 'open-box';
  if (/remis a neuf|refurbished|reconditionn|remise a neuf/.test(n)) return 'refurbished';
  return 'new';
}

/**
 * Toutes les resolutions plausibles pour un produit, de la meilleure a la plus
 * sure. Best Buy sert ses visuels depuis un CDN dont le chemin contient la
 * taille : .../products/1500x1500/191/19189/19189882.jpg
 *
 * La haute resolution n'existe pas toujours. On derive donc les variantes
 * intermediaires a partir de l'URL fournie, ce qui donne au composant
 * d'affichage plusieurs chances avant d'abandonner.
 */
function imageCandidates(p: BbProduct): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (u: string | null | undefined) => {
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  };

  add(p.highResImage);

  const base = p.highResImage ?? p.thumbnailImage;
  if (base) {
    for (const size of ['1000x1000', '500x500', '250x250']) {
      add(base.replace(/\/\d+x\d+\//, `/${size}/`));
    }
  }

  add(p.thumbnailImage);
  return out;
}

function toRawProduct(p: BbProduct, categorySlug: string): RawProduct | null {
  if (!p.sku || !p.name || typeof p.salePrice !== 'number' || p.salePrice <= 0) return null;
  if (p.isVisible === false) return null;

  const regular = typeof p.regularPrice === 'number' ? p.regularPrice : null;

  return {
    sku: String(p.sku),
    url: p.productUrl?.startsWith('http') ? p.productUrl : `${BASE}${p.productUrl}`,
    title: p.name.trim(),
    brand: null, // absent du listing (enrichissement différé, voir README)
    model: extractModel(p.name),
    imageUrl: p.highResImage ?? p.thumbnailImage ?? null,
    // Deja present dans la reponse de listing : aucune requete supplementaire.
    description: p.shortDescription?.trim() || null,
    imageUrls: imageCandidates(p),
    price: p.salePrice,
    // On ne garde le « régulier » que s'il est réellement supérieur au prix payé.
    listPrice: regular && regular > p.salePrice ? regular : null,
    currency: 'CAD',
    inStock: p.isPreorderable ? false : true,
    rating: p.customerRating ?? null,
    ratingCount: p.customerRatingCount ?? null,
    storeCategory: p.categoryName ?? null,
    categorySlug,
    condition: detectCondition(p.name),
    availability: p.isOnlineOnly
      ? 'en-ligne'
      : p.isInStoreOnly
        ? 'en-magasin'
        : 'les-deux',
    marketplace: Boolean(p.isMarketplace),
    sellerName: p.seller?.name ?? null,
  };
}

/**
 * MUR DUR DE L'API BEST BUY.
 *
 * Constate empiriquement : pour le rayon « Portables », l'API annonce
 * `totalPages: 243` et `total: 24212`... mais la page 21 renvoie ZERO produit.
 * Toute requete est plafonnee a 20 pages, soit 2 000 produits, quelle que soit
 * la taille reelle du rayon. Le `totalPages` renvoye est donc trompeur.
 *
 * C'est ce mur qui donnait « 2 000 » sur presque toutes les categories du site :
 * ce n'etait pas un reglage de notre cote, c'etait le plafond du marchand.
 */
const PAGE_CAP = 20;
const MAX_REACHABLE_PER_QUERY = PAGE_CAP * PAGE_SIZE; // 2 000

/** Profondeur maximale de descente dans l'arborescence. */
const MAX_DEPTH = 3;

interface BbCategoryNode {
  id: string;
  name?: string;
  productCount?: number;
  subCategories?: BbCategoryNode[];
}

interface CrawlBudget {
  emitted: number;
  pagesUsed: number;
  seen: Set<string>;
}

/** Pagination d'un rayon unique, bornee par le mur de l'API. */
async function* paginate(
  catId: string,
  slug: string,
  ctx: CrawlContext,
  budget: CrawlBudget,
): AsyncGenerator<RawProduct> {
  let page = 1;

  while (page <= PAGE_CAP) {
    if (ctx.signal.aborted) return;
    if (budget.pagesUsed >= ctx.limits.maxPages) return;
    if (budget.emitted >= ctx.limits.maxProducts) return;

    const url =
      `${BASE}/api/v2/json/search?categoryid=${encodeURIComponent(catId)}` +
      `&page=${page}&pageSize=${PAGE_SIZE}&lang=fr-CA`;

    const data = await ctx.getJson<BbSearchResponse>(url);
    budget.pagesUsed++;

    const batch = data.products ?? [];
    // Page vide = fin reelle du rayon, ou mur atteint. Dans les deux cas on
    // s'arrete : insister ne renverra jamais rien de plus.
    if (batch.length === 0) return;

    for (const p of batch) {
      if (budget.seen.has(p.sku)) continue;
      budget.seen.add(p.sku);
      const raw = toRawProduct(p, slug);
      if (!raw) continue;
      yield raw;
      if (++budget.emitted >= ctx.limits.maxProducts) return;
    }

    page++;
  }
}

/**
 * Parcourt un rayon en DESCENDANT dans ses sous-rayons quand il depasse le mur.
 *
 * C'est la seule facon de recuperer plus de 2 000 produits d'un rayon : chaque
 * sous-rayon dispose de sa propre fenetre de 2 000. « Portables » plafonnait a
 * 2 000 sur 24 212 ; en descendant, on atteint l'essentiel du catalogue.
 *
 * La descente est automatique et generale : aucun mapping manuel a maintenir,
 * et tout nouveau sous-rayon cree par le marchand est pris en compte de lui-meme.
 */
async function* crawlNode(
  catId: string,
  slug: string,
  ctx: CrawlContext,
  budget: CrawlBudget,
  depth: number,
): AsyncGenerator<RawProduct> {
  if (ctx.signal.aborted) return;
  if (budget.emitted >= ctx.limits.maxProducts) return;
  if (budget.pagesUsed >= ctx.limits.maxPages) return;

  let node: BbCategoryNode | null = null;
  if (depth < MAX_DEPTH) {
    try {
      node = await ctx.getJson<BbCategoryNode>(
        `${BASE}/api/v2/json/category/${encodeURIComponent(catId)}`,
      );
      budget.pagesUsed++;
    } catch {
      // Fiche de rayon indisponible : on pagine quand meme, sans descendre.
      node = null;
    }
  }

  const total = node?.productCount ?? 0;
  const children = (node?.subCategories ?? []).filter((c) => (c.productCount ?? 0) > 0);

  if (total > MAX_REACHABLE_PER_QUERY && children.length > 0) {
    ctx.log(
      `  rayon ${catId} : ${total} produits, au-dela du mur de ${MAX_REACHABLE_PER_QUERY}` +
        ` -> descente dans ${children.length} sous-rayon(s)`,
    );
    for (const child of children) {
      yield* crawlNode(String(child.id), slug, ctx, budget, depth + 1);
    }
    return;
  }

  if (node) ctx.log(`  rayon ${catId} -> ${total} produits`);
  yield* paginate(catId, slug, ctx, budget);
}

/** Point d'entree : parcourt les rayons mappes pour un slug canonique. */
async function* crawlCategoryIds(
  ids: string[],
  slug: string,
  ctx: CrawlContext,
): AsyncGenerator<RawProduct> {
  // Le budget est partage entre tous les rayons du slug, et la deduplication
  // couvre tout l'arbre : un meme SKU vit souvent dans plusieurs sous-rayons.
  const budget: CrawlBudget = { emitted: 0, pagesUsed: 0, seen: new Set() };

  for (const catId of ids) {
    yield* crawlNode(catId, slug, ctx, budget, 0);
  }
}

export const bestBuyAdapter: StoreAdapter = {
  id: 'bestbuy-ca',

  capabilities: { deals: true, categories: true, search: true },

  categories: Object.keys(CATEGORY_MAP),

  async *listCategory(slug, ctx) {
    const ids = CATEGORY_MAP[slug];
    if (!ids) {
      ctx.log(`  (aucun rayon Best Buy mappé pour "${slug}")`);
      return;
    }
    yield* crawlCategoryIds(ids, slug, ctx);
  },

  /**
   * Stratégie « deals » : on ratisse les rayons à fort volume. On ne filtre PAS
   * sur le rabais annoncé par le marchand — c'est notre moteur de score qui
   * tranche, à partir de notre propre historique de prix.
   */
  async *listDeals(ctx) {
    const perCategory = Math.max(
      200,
      Math.floor(ctx.limits.maxProducts / DEALS_CATEGORIES.length),
    );
    const pagesPer = Math.max(2, Math.floor(ctx.limits.maxPages / DEALS_CATEGORIES.length));

    for (const slug of DEALS_CATEGORIES) {
      if (ctx.signal.aborted) return;
      ctx.log(`- ${slug}`);
      const sub: CrawlContext = {
        ...ctx,
        limits: { maxProducts: perCategory, maxPages: pagesPer },
      };
      yield* crawlCategoryIds(CATEGORY_MAP[slug], slug, sub);
    }
  },

  async *search(query, ctx) {
    let page = 1;
    let totalPages = 1;
    let emitted = 0;

    do {
      if (ctx.signal.aborted || page > ctx.limits.maxPages) return;

      const url =
        `${BASE}/api/v2/json/search?query=${encodeURIComponent(query)}` +
        `&page=${page}&pageSize=${PAGE_SIZE}&lang=fr-CA`;

      const data = await ctx.getJson<BbSearchResponse>(url);
      if (page === 1) totalPages = Math.max(1, data.totalPages ?? 1);

      for (const p of data.products ?? []) {
        const raw = toRawProduct(p, guessSlug(p.categoryName));
        if (!raw) continue;
        yield raw;
        if (++emitted >= ctx.limits.maxProducts) return;
      }
      page++;
    } while (page <= totalPages);
  },
};

/** Rattrapage grossier pour la recherche, où le rayon d'origine est inconnu. */
function guessSlug(categoryName?: string | null): string {
  const n = (categoryName ?? '').toLowerCase();
  if (/t[eé]l[eé]viseur|television/.test(n)) return 'televiseurs';
  if (/casque|[eé]couteur/.test(n)) return 'casques';
  if (/portable|laptop/.test(n)) return 'portables';
  if (/moniteur/.test(n)) return 'moniteurs';
  if (/tablette/.test(n)) return 'tablettes';
  if (/t[eé]l[eé]phone/.test(n)) return 'telephones';
  if (/jeu|console/.test(n)) return 'jeux-video';
  if (/aspirateur/.test(n)) return 'aspirateurs';
  return 'electronique';
}
