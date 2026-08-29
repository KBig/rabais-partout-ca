import type { StoreAdapter, RawProduct, CrawlContext } from '../types';
import { enParallele } from '../core/parallele';

/**
 * IKEA Canada.
 *
 * ----------------------------------------------------------------------------
 * UNE API PUBLIQUE, ET DECLAREE OUVERTE
 * ----------------------------------------------------------------------------
 *
 * Le site appelle `sik.search.blue.cdtapps.com` pour remplir ses pages de
 * rayon. Cet hote sert son propre robots.txt, et il dit exactement ceci :
 *
 *     User-agent: *
 *     Allow: /
 *
 * Rien a contourner, rien a deviner : la permission est ecrite.
 *
 * ----------------------------------------------------------------------------
 * UNE REQUETE PAR RAYON
 * ----------------------------------------------------------------------------
 *
 * `size` n'est pas plafonne de facon utile : `size=1000` ramene la categorie
 * entiere en une seule reponse. Les 148 canapes arrivent d'un coup. Il n'y a
 * donc pas de pagination a gerer — et surtout aucun mur comme chez Best Buy ou
 * Newegg, ou le total annonce depasse largement ce qui est atteignable.
 *
 * Les donnees incluent la note moyenne ET le nombre d'avis, ce que peu de
 * marchands exposent sur une page de rayon.
 */

const API = 'https://sik.search.blue.cdtapps.com/ca/fr/product-list-page';

/** Assez large pour ramener n'importe quel rayon d'un seul coup. */
const TAILLE = 1000;

/**
 * Rattachement d'un produit a l'une de NOS categories.
 *
 * ----------------------------------------------------------------------------
 * PAR SON FIL D'ARIANE, PAS PAR SON RAYON
 * ----------------------------------------------------------------------------
 *
 * Une premiere version listait vingt-deux codes de rayon ecrits a la main.
 * Elle en manquait deux cent soixante-quatorze : leur sitemap en publie 296,
 * dont la plupart sous un format numerique que mon filtre ignorait. Le
 * catalogue s'arretait a 5 435 articles.
 *
 * Chaque produit porte pourtant son propre chemin — « Canapes et fauteuils >
 * Canapes > Canapes trois places ». On classe donc a partir de LUI : on
 * parcourt tous les rayons pour la couverture, et le produit dit lui-meme ou
 * il va. Plus de liste a tenir a jour.
 */
const REGLES: ReadonlyArray<readonly [RegExp, string]> = [
  // --- meubles, du plus precis au plus general ----------------------------
  [/canap|fauteuil|causeuse|sofa|repose-pied/i, 'salon'],
  [/table basse|table d.appoint|meuble t[ée]l|banc tv/i, 'salon'],
  [/salle [àa] manger|table et chaise|chaise de cuisine|tabouret/i, 'salle-a-manger'],
  [/\blit\b|lits|matelas|sommier|t[êe]te de lit|commode|table de chevet/i, 'chambre'],
  [/bureau|chaise de bureau|si[èe]ge de bureau/i, 'bureau-meubles'],
  [/[ée]tag[èe]re|biblioth[èe]que|rangement|armoire|vitrine|penderie|casier|bo[îi]te/i, 'rangement'],

  // --- literie et textiles -------------------------------------------------
  [/matelas|surmatelas|oreiller|couette|housse de couette|drap|literie|couverture/i, 'literie'],
  [/rideau|store|voilage/i, 'decoration'],
  [/tapis|coussin|jet[ée]|plaid|cadre|miroir|d[ée]coration|bougie|vase|plante|pot/i, 'decoration'],

  // --- luminaires ----------------------------------------------------------
  [/lampe|luminaire|suspension|applique|ampoule|[ée]clairage|abat-jour/i, 'luminaires'],

  // --- cuisine -------------------------------------------------------------
  [/[ée]lectrom[ée]nager|four|plaque|hotte|lave-vaisselle|r[ée]frig[ée]rateur/i, 'gros-electro'],
  [/cafeti[èe]re|bouilloire|grille-pain|mixeur|robot culinaire/i, 'petits-electro'],
  [/vaisselle|assiette|verre|couvert|casserole|po[êe]le|ustensile|cuisson|batterie de cuisine/i, 'cuisine'],
  [/cuisine|[ée]vier|robinet|fa[çc]ade|comptoir|tiroir/i, 'cuisine'],

  // --- salle de bains, buanderie ------------------------------------------
  [/salle de bain|serviette|douche|lavabo|toilette/i, 'maison'],
  [/lessive|nettoyage|buanderie|recyclage|poubelle/i, 'maison'],

  // --- exterieur -----------------------------------------------------------
  [/ext[ée]rieur|jardin|balcon|terrasse|barbecue/i, 'jardinage'],

  // --- enfant, jeu ---------------------------------------------------------
  [/b[ée]b[ée]|nourrisson|langer|poussette/i, 'bebe'],
  [/enfant|jouet|peluche|jeu/i, 'jouets'],

  // --- divers --------------------------------------------------------------
  [/maison intelligente|connect[ée]|domotique/i, 'maison-intelligente'],
  [/haut-parleur|enceinte|son\b/i, 'audio'],
  [/animal|chat|chien/i, 'animaux'],
  [/outil|quincaillerie|vis|fixation/i, 'quincaillerie'],
];

/** Ce qui n'est pas un produit comparable. */
const IGNORER =
  /carte-cadeau|service|livraison|montage|installation|garantie|restaurant|bistro|[ée]picerie su[ée]doise|repas/i;

/** Classe un produit d'apres son propre fil d'Ariane. */
export function slugPourChemin(chemin: readonly string[]): string | null {
  const texte = chemin.join(' ');
  if (IGNORER.test(texte)) return null;

  // Du plus precis au plus general : le dernier niveau decrit le mieux.
  for (const niveau of [...chemin].reverse()) {
    for (const [motif, slug] of REGLES) if (motif.test(niveau)) return slug;
  }
  return null;
}

interface IkeaProduct {
  name?: string;
  typeName?: string;
  mainImageAlt?: string;
  mainImageUrl?: string;
  pipUrl?: string;
  itemNo?: string;
  ratingValue?: number | null;
  ratingCount?: number | null;
  onlineSellable?: boolean;
  salesPrice?: { numeral?: number } | null;
  categoryPath?: Array<{ name?: string }>;
}

interface IkeaResponse {
  productListPage?: {
    productWindow?: IkeaProduct[];
    productCount?: number;
  };
}

function toRawProduct(p: IkeaProduct): RawProduct | null {
  const prix = p.salesPrice?.numeral;
  if (!p.itemNo || typeof prix !== 'number' || prix <= 0) return null;

  // « GLOSTAD Canapé, Knisa gris foncé » : le libellé de l'image porte le nom
  // complet, avec la finition. Le couple `name` + `typeName` seul donnerait
  // « GLOSTAD Canapé », qui ne distingue pas deux coloris.
  const titre = p.mainImageAlt?.trim() || [p.name, p.typeName].filter(Boolean).join(' ');
  if (!titre) return null;

  // Le fil d'Ariane decrit le produit mieux qu'un intitule de rayon : il sert
  // a la fois a le classer et a decrire ses caracteristiques.
  const niveaux = (p.categoryPath ?? [])
    .map((c) => c.name)
    .filter((n): n is string => Boolean(n));

  const slug = slugPourChemin([...niveaux, p.typeName ?? '', titre]);
  if (!slug) return null;

  const chemin = niveaux.join(' · ');

  return {
    sku: p.itemNo,
    url: p.pipUrl ?? `https://www.ikea.com/ca/fr/p/-${p.itemNo}/`,
    title: titre,
    brand: 'IKEA',
    // Le numero d'article EST la reference chez IKEA : c'est ce qu'on donne en
    // magasin pour retrouver un produit.
    model: p.itemNo,
    imageUrl: p.mainImageUrl ?? null,
    imageUrls: p.mainImageUrl ? [p.mainImageUrl] : [],
    description: chemin || null,
    price: prix,
    // IKEA n'affiche pas de « prix regulier » barre sur ses pages de rayon.
    listPrice: null,
    currency: 'CAD',
    inStock: p.onlineSellable ?? null,
    // Une note sans avis ne veut rien dire : on ne retient le couple qu'entier.
    rating: (p.ratingCount ?? 0) > 0 ? (p.ratingValue ?? null) : null,
    ratingCount: (p.ratingCount ?? 0) > 0 ? p.ratingCount! : null,
    storeCategory: p.categoryPath?.[p.categoryPath.length - 1]?.name ?? null,
    categorySlug: slug,
    condition: 'new',
    availability: 'les-deux',
    marketplace: false,
    sellerName: null,
  };
}

/**
 * Les rayons, tous, lus dans leur sitemap.
 *
 * 296 y sont publies. Les parcourir tous coute 296 requetes — une par rayon,
 * puisque `size=1000` ramene chacun d'un coup. Les recoupements entre rayon
 * parent et sous-rayon sont absorbes par la deduplication sur le numero
 * d'article.
 */
async function codesRayons(ctx: CrawlContext): Promise<string[]> {
  const xml = await ctx.getText('https://www.ikea.com/sitemaps/cat-fr-CA_1.xml');
  const codes = new Set<string>();

  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    // Deux formats coexistent : « fu003 » pour les grands rayons, un nombre
    // pour les sous-rayons. Ne prendre que le premier laissait de cote 274
    // rayons sur 296.
    const code = m[1].match(/\/cat\/[a-z0-9-]+-([a-z]{2}\d{3}|\d{6,})\/?$/i)?.[1];
    if (code) codes.add(code);
  }
  return [...codes];
}

async function* parcourir(ctx: CrawlContext, filtre?: string): AsyncGenerator<RawProduct> {
  const codes = await codesRayons(ctx);
  ctx.log(`  ${codes.length} rayons publies par leur sitemap`);

  const vus = new Set<string>();
  let emis = 0;
  const parSlug = new Map<string, number>();

  // Les rayons sont independants : rien n'oblige a attendre la reponse de l'un
  // pour demander le suivant. Le limiteur de debit garde la main sur la cadence.
  const lots = enParallele(
    codes,
    8,
    async (code) => {
      try {
        return await ctx.getJson<IkeaResponse>(`${API}?category=${code}&size=${TAILLE}`);
      } catch {
        return null; // un rayon indisponible ne doit pas interrompre les autres
      }
    },
    () => ctx.signal.aborted || emis >= ctx.limits.maxProducts,
  );

  for await (const data of lots) {
    if (ctx.signal.aborted || emis >= ctx.limits.maxProducts) break;
    if (!data) continue;

    for (const p of data.productListPage?.productWindow ?? []) {
      if (!p.itemNo || vus.has(p.itemNo)) continue;

      const raw = toRawProduct(p);
      if (!raw) continue;
      if (filtre && raw.categorySlug !== filtre) continue;

      vus.add(p.itemNo);
      parSlug.set(raw.categorySlug!, (parSlug.get(raw.categorySlug!) ?? 0) + 1);
      yield raw;
      if (++emis >= ctx.limits.maxProducts) break;
    }
  }

  for (const [slug, n] of [...parSlug].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    ctx.log(`  ${slug} ← ${n} produits`);
  }
}

export const ikeaAdapter: StoreAdapter = {
  id: 'ikea-ca',

  // Pas de recherche : leur robots.txt interdit les URL de recherche du site,
  // et l'API de rayon suffit a couvrir le catalogue.
  capabilities: { deals: true, categories: true, search: false },

  categories: [...new Set(REGLES.map(([, s]) => s))],

  async *listCategory(slug, ctx) {
    yield* parcourir(ctx, slug);
  },

  async *listDeals(ctx) {
    yield* parcourir(ctx);
  },
};
