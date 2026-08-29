import type { StoreAdapter, RawProduct, CrawlContext } from '../types';

/**
 * ADAPTATEUR SHOPIFY GÉNÉRIQUE.
 *
 * ----------------------------------------------------------------------------
 * POURQUOI CELUI-CI PLUTÔT QU'UN FLUX PARTENAIRE
 * ----------------------------------------------------------------------------
 *
 * Toute boutique Shopify sert son catalogue à l'adresse `/products.json`. Ce
 * n'est ni une API privée ni un contournement : c'est un point d'entrée prévu,
 * documenté, ouvert à tous.
 *
 * L'alternative envisagée — s'inscrire aux programmes d'affiliation pour
 * obtenir un flux produit — avait trois défauts que celui-ci n'a pas :
 *
 *   L'APPROBATION n'est jamais garantie. Les réseaux d'affiliation examinent
 *   le site demandeur, et refusent régulièrement ceux qui n'ont pas encore
 *   d'audience. On aurait pu remplir les formulaires pour rien.
 *
 *   LE DÉLAI se compte en jours, parfois en semaines.
 *
 *   LES DONNÉES d'un flux d'affiliation sont souvent plus pauvres : prix et
 *   titre, rarement le stock, presque jamais les caractéristiques.
 *
 * Ici, tout arrive en une requête : titre, marque, type de produit, prix, prix
 * régulier, disponibilité, numéro de modèle, images, et des étiquettes qui
 * décrivent les fonctionnalités.
 *
 * ----------------------------------------------------------------------------
 * UN ADAPTATEUR, N MAGASINS
 * ----------------------------------------------------------------------------
 *
 * Ajouter une enseigne Shopify se réduit à une ligne dans le registre. Vérifié
 * sur huit enseignes canadiennes, dont Brick et Leon's — les deux plus gros
 * vendeurs de meubles et d'électroménagers du pays.
 */

/** Maximum accepté par Shopify sur ce point d'entrée. */
const PAGE_SIZE = 250;

/** Garde-fou : au-delà, c'est qu'on tourne en rond. */
const MAX_PAGES = 200;

interface ShopifyVariant {
  id: number;
  sku?: string | null;
  price?: string | null;
  compare_at_price?: string | null;
  available?: boolean;
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html?: string | null;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string[] | string | null;
  variants?: ShopifyVariant[];
  images?: Array<{ src?: string | null }>;
}

/**
 * Le champ « vendor » n'est pas toujours une marque.
 *
 * Chez Brick, un televiseur TCL portait « /MasterData/Vendor/vendor-010K » —
 * une reference interne echappee dans le catalogue public. Affichee telle
 * quelle, elle passerait pour un nom de marque, polluerait le filtre par
 * marque et le rapprochement avec les fabricants.
 *
 * On ecarte ce qui ne ressemble pas a un nom : chemins, identifiants
 * techniques, chaines sans la moindre voyelle.
 */
function marqueValide(v: string | null | undefined): string | null {
  const t = v?.trim();
  if (!t || t.length < 2 || t.length > 60) return null;
  if (/[\\/]/.test(t)) return null;
  if (/^(vendor|supplier|masterdata)[-_]?/i.test(t)) return null;
  if (!/[aeiouyàâäéèêëîïôöùûü]/i.test(t)) return null;
  return t;
}

const nombre = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Texte lisible depuis le HTML du descriptif.
 *
 * Le contenu vient d'un tiers : il n'est jamais rendu comme du HTML. On en
 * extrait le texte, et lui seul.
 */
function texteDe(html: string | null | undefined): string | null {
  if (!html) return null;
  const t = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 15 ? t.slice(0, 600) : null;
}

/**
 * Les étiquettes Shopify décrivent souvent les fonctionnalités.
 *
 * Chez Brick : « app feature:Convection », « app feature:Double Oven ». Ces
 * mentions alimentent directement l'analyse par composante, qui lit le titre
 * et le descriptif. On les y ajoute plutôt que de les perdre.
 */
function fonctionnalites(tags: string[] | string | null | undefined): string {
  const liste = Array.isArray(tags)
    ? tags
    : typeof tags === 'string'
      ? tags.split(',')
      : [];
  return liste
    .map((t) => t.replace(/^[a-z ]*feature:\s*/i, '').trim())
    .filter((t) => t.length > 2 && t.length < 40)
    .slice(0, 25)
    .join('. ');
}

export interface ShopifyStoreConfig {
  id: string;
  /** Racine du site, sans barre finale. */
  base: string;
  /** `product_type` Shopify → notre catégorie. Première règle qui matche. */
  rules: ReadonlyArray<readonly [RegExp, string]>;
  /** Types de produits à ignorer entièrement (services, cartes-cadeaux…). */
  ignore?: readonly RegExp[];
}

/**
 * Rattache un produit à l'une de nos catégories, ou à rien.
 *
 * Le champ `product_type` est LAISSE VIDE par beaucoup de marchands : chez
 * Bouclair, il l'est pour tout le catalogue, et la premiere version de cet
 * adaptateur n'y collectait donc aucun produit. Le titre, lui, dit toujours de
 * quoi il s'agit — « Floor Lamp Ceramic Base », « White 4-Piece Bamboo Sheet
 * Set ». On s'y rabat, puis sur les etiquettes.
 *
 * L'ordre reste celui de la fiabilite : un type declare par le marchand vaut
 * mieux qu'un mot devine dans un titre.
 */
export function slugPourType(
  type: string,
  cfg: ShopifyStoreConfig,
  titre = '',
  tags = '',
): string | null {
  for (const motif of cfg.ignore ?? []) {
    if (motif.test(type) || motif.test(titre)) return null;
  }

  for (const source of [type, titre, tags]) {
    if (!source) continue;
    for (const [motif, slug] of cfg.rules) if (motif.test(source)) return slug;
  }
  return null;
}

function toRawProduct(
  p: ShopifyProduct,
  cfg: ShopifyStoreConfig,
  slug: string,
): RawProduct | null {
  // La première variante porte le prix affiché. Les autres sont des déclinaisons
  // (taille, couleur) que notre regroupement de variantes gère déjà en aval.
  const v = p.variants?.[0];
  const prix = nombre(v?.price);
  if (!prix || !p.title) return null;

  const regulier = nombre(v?.compare_at_price);
  const image = p.images?.[0]?.src ?? null;

  const descriptif = texteDe(p.body_html);
  const atouts = fonctionnalites(p.tags);
  const description = [descriptif, atouts].filter(Boolean).join(' ') || null;

  return {
    sku: String(p.id),
    url: `${cfg.base}/products/${p.handle}`,
    title: p.title.trim(),
    brand: marqueValide(p.vendor),
    // Le SKU de la variante est le numéro de modèle du fabricant chez la
    // plupart des enseignes — c'est ce qui rend la comparaison inter-magasins
    // possible.
    model: v?.sku?.trim() || null,
    imageUrl: image,
    imageUrls: image ? [image] : [],
    description,
    price: prix,
    // Le « régulier » n'est retenu que s'il dépasse réellement le prix payé.
    listPrice: regulier && regulier > prix ? regulier : null,
    currency: 'CAD',
    inStock: v?.available ?? null,
    rating: null,
    ratingCount: null,
    storeCategory: p.product_type ?? null,
    categorySlug: slug,
    condition: 'new',
    availability: 'les-deux',
    marketplace: false,
    sellerName: null,
  };
}

/**
 * Vérifie que le marchand n'interdit pas ce point d'entrée.
 *
 * Il est ouvert par défaut chez Shopify, mais une boutique peut le fermer dans
 * son robots.txt. On le lit avant de collecter, une fois par passe : demander
 * la permission coûte une requête, l'ignorer coûte le respect du site.
 */
async function autorise(cfg: ShopifyStoreConfig, ctx: CrawlContext): Promise<boolean> {
  try {
    const txt = await ctx.getText(`${cfg.base}/robots.txt`);
    const groupe = txt.split(/user-agent:\s*\*/i)[1]?.split(/user-agent:/i)[0] ?? txt;
    if (/^\s*disallow:\s*\/products\.json/im.test(groupe)) {
      ctx.log('  robots.txt interdit /products.json : collecte annulée');
      return false;
    }
    if (/^\s*disallow:\s*\/\s*$/im.test(groupe)) {
      ctx.log('  robots.txt interdit tout le site : collecte annulée');
      return false;
    }
  } catch {
    // Pas de robots.txt lisible : Shopify laisse ce point d'entrée ouvert.
  }
  return true;
}

/** Parcourt tout le catalogue, page après page. */
async function* parcourir(
  cfg: ShopifyStoreConfig,
  ctx: CrawlContext,
  filtre?: string,
): AsyncGenerator<RawProduct> {
  if (!(await autorise(cfg, ctx))) return;

  let emis = 0;
  const parSlug = new Map<string, number>();

  for (let page = 1; page <= Math.min(MAX_PAGES, ctx.limits.maxPages); page++) {
    if (ctx.signal.aborted || emis >= ctx.limits.maxProducts) break;

    const url = `${cfg.base}/products.json?limit=${PAGE_SIZE}&page=${page}`;
    let lot: ShopifyProduct[];
    try {
      lot = (await ctx.getJson<{ products?: ShopifyProduct[] }>(url)).products ?? [];
    } catch {
      break;
    }
    if (lot.length === 0) break;

    for (const p of lot) {
      const etiquettes = Array.isArray(p.tags) ? p.tags.join(' ') : (p.tags ?? '');
      const slug = slugPourType(p.product_type ?? '', cfg, p.title ?? '', etiquettes);
      if (!slug) continue;
      if (filtre && slug !== filtre) continue;

      const raw = toRawProduct(p, cfg, slug);
      if (!raw) continue;

      parSlug.set(slug, (parSlug.get(slug) ?? 0) + 1);
      yield raw;
      if (++emis >= ctx.limits.maxProducts) break;
    }
  }

  for (const [slug, n] of [...parSlug].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    ctx.log(`  ${slug} -> ${n} produits`);
  }
}

/**
 * Fabrique l'adaptateur d'une boutique Shopify.
 *
 * Le catalogue n'est pas interrogeable par rayon : `/products.json` renvoie
 * tout, dans l'ordre du marchand. Parcourir « une catégorie » revient donc à
 * parcourir le catalogue en ne retenant qu'elle — inefficace pour une seule
 * catégorie, sans surcoût pour une collecte complète, qui est le cas normal.
 */
export function createShopifyAdapter(cfg: ShopifyStoreConfig): StoreAdapter {
  const slugs = [...new Set(cfg.rules.map(([, s]) => s))];

  return {
    id: cfg.id,
    capabilities: { deals: true, categories: true, search: false },
    categories: slugs,

    async *listCategory(slug, ctx) {
      if (!slugs.includes(slug)) {
        ctx.log(`  (aucun type de produit mappé pour "${slug}")`);
        return;
      }
      yield* parcourir(cfg, ctx, slug);
    },

    async *listDeals(ctx) {
      yield* parcourir(cfg, ctx);
    },
  };
}

/**
 * Vocabulaire commun aux enseignes de meubles, literie et électroménager.
 *
 * Les `product_type` de Shopify sont écrits par le marchand : « Double Wall
 * Oven », « Rocker Recliner », « Floor Lamp ». Une table de mots-clés couvre
 * ces variations sans imposer une liste figée par enseigne.
 *
 * Comme pour Newegg, un type non reconnu est IGNORÉ. Quelques produits de
 * moins ne coûtent rien ; un produit mal rangé fausse une catégorie entière,
 * ses statistiques et son classement.
 */
export const REGLES_MAISON: ReadonlyArray<readonly [RegExp, string]> = [
  // --- électroménagers -----------------------------------------------------
  [/refrigerator|fridge|freezer|réfrigérateur|congélateur/i, 'gros-electro'],
  [/washer|dryer|laundry|laveuse|sécheuse/i, 'gros-electro'],
  [/dishwasher|lave-vaisselle/i, 'gros-electro'],
  [/\brange\b|oven|cooktop|hood|cuisinière|four|hotte/i, 'gros-electro'],
  [/microwave|micro-ondes/i, 'petits-electro'],
  [/air fryer|blender|toaster|coffee|kettle|mixer|friteuse|grille-pain|cafetière/i, 'petits-electro'],
  [/vacuum|aspirateur/i, 'aspirateurs'],

  // --- literie -------------------------------------------------------------
  [/mattress|matelas|box spring|sommier/i, 'literie'],
  [/pillow|duvet|comforter|sheet|bedding|oreiller|couette|draps?/i, 'literie'],

  // --- meubles -------------------------------------------------------------
  [/sofa|couch|loveseat|sectional|recliner|canapé|fauteuil|causeuse/i, 'salon'],
  [/coffee table|end table|tv stand|console|table de salon|meuble télé/i, 'salon'],
  [/dining|kitchen table|bar stool|salle à manger|tabouret/i, 'salle-a-manger'],
  [/bed\b|headboard|dresser|nightstand|chest|armoire|lit\b|commode|table de chevet/i, 'chambre'],
  [/desk|office chair|bookcase|bureau|bibliothèque|chaise de bureau/i, 'bureau-meubles'],
  [/shelf|shelving|storage|cabinet|étagère|rangement/i, 'rangement'],

  // --- décoration et luminaires -------------------------------------------
  [/lamp|lighting|chandelier|sconce|lampe|luminaire|plafonnier/i, 'luminaires'],
  [/\brug\b|curtain|mirror|wall art|cushion|tapis|rideau|miroir|coussin/i, 'decoration'],

  // --- cuisine et table ----------------------------------------------------
  [/cookware|bakeware|dinnerware|flatware|glassware|knife|casserole|vaisselle|coutellerie/i, 'cuisine'],

  // --- extérieur -----------------------------------------------------------
  [/patio|outdoor|garden|bbq|barbecue|jardin|extérieur/i, 'jardinage'],

  // --- électronique --------------------------------------------------------
  [/\btv\b|television|téléviseur|soundbar|barre de son/i, 'televiseurs'],
  [/speaker|headphone|audio|haut-parleur|écouteur/i, 'audio'],
];

/**
 * Vocabulaire des enseignes de mode, de decoration et de loisirs creatifs.
 *
 * Les meubles et l'electromenager ne couvrent pas tout : Frank And Oak vend du
 * vetement, DeSerres du materiel d'artiste, Clement des articles pour enfants.
 * Meme discipline que partout ailleurs — un type non reconnu est IGNORE.
 */
export const REGLES_MODE: ReadonlyArray<readonly [RegExp, string]> = [
  [/shirt|tee|sweater|hoodie|jacket|coat|pant|jean|dress|skirt|blouse|chandail|manteau|pantalon|robe|jupe/i, 'vetements'],
  [/shoe|boot|sneaker|sandal|chaussure|botte|espadrille/i, 'accessoires-mode'],
  [/bag|backpack|purse|wallet|luggage|sac|sacoche|valise/i, 'bagages'],
  [/jewel|necklace|bracelet|earring|ring\b|bijou|collier|boucle/i, 'bijoux'],
  [/watch|montre/i, 'montres-mode'],
  [/baby|infant|toddler|stroller|bebe|poussette/i, 'bebe'],
  [/toy|game|puzzle|jouet|jeu/i, 'jouets'],
  [/paint|brush|canvas|easel|marker|pencil|sketch|peinture|pinceau|toile|crayon/i, 'papeterie'],
  [/paper|notebook|journal|papier|cahier/i, 'papier'],
  [/mattress|pillow|duvet|matelas|oreiller|couette/i, 'literie'],
  [/lamp|lighting|lampe|luminaire/i, 'luminaires'],
  [/\brug\b|cushion|curtain|mirror|vase|frame|tapis|coussin|rideau|miroir|cadre/i, 'decoration'],
  [/cookware|dinnerware|glassware|vaisselle|casserole/i, 'cuisine'],
  [/storage|basket|bin|rangement|panier/i, 'rangement'],
];

/** Types à ne jamais collecter : ce ne sont pas des produits comparables. */
export const IGNORER_MAISON: readonly RegExp[] = [
  /gift card|carte-cadeau|warranty|garantie|protection plan|delivery|livraison|service|assembly|montage|sample|échantillon|financ/i,
];
