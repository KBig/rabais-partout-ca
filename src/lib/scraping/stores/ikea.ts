import type { StoreAdapter, RawProduct, CrawlContext } from '../types';

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
 * Rayons IKEA, releves dans leur sitemap `cat-fr-CA`.
 *
 * Le code est stable ; l'intitule sert a le rattacher a l'une de NOS
 * categories. On garde les rayons FEUILLES et on ecarte les rayons parents
 * (« tous les meubles », « exterieur »), qui reprennent le contenu de leurs
 * enfants et le compteraient deux fois.
 */
const RAYONS: ReadonlyArray<readonly [string, string]> = [
  ['fu003', 'salon'], // canapés
  ['fu006', 'salon'], // fauteuils et chaises d'appoint
  ['fu004', 'bureau-meubles'], // tables et bureaux
  ['fu002', 'salle-a-manger'], // tables et chaises
  ['st003', 'rangement'], // vitrines et meubles de rangement
  ['st006', 'rangement'], // rangement mural
  ['st007', 'rangement'], // petits rangements
  ['bm003', 'chambre'], // lits
  ['bm002', 'literie'], // matelas
  ['tl004', 'literie'], // literie
  ['tl001', 'decoration'], // textiles pour la maison
  ['tl002', 'decoration'], // rideaux et stores
  ['tl003', 'decoration'], // textiles salle de bains
  ['li002', 'luminaires'], // suspensions et appliques
  ['pp001', 'decoration'], // plantes, pots et cache-pots
  ['ka003', 'cuisine'], // rangements pour cuisine
  ['ka002', 'petits-electro'], // électroménagers
  ['ba001', 'maison'], // salle de bains
  ['od003', 'jardinage'], // mobilier d'extérieur
  ['hs001', 'maison-intelligente'],
  ['lc001', 'maison'], // lessive et nettoyage
  ['bc003', 'bebe'], // enfants
];

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

function toRawProduct(p: IkeaProduct, slug: string): RawProduct | null {
  const prix = p.salesPrice?.numeral;
  if (!p.itemNo || typeof prix !== 'number' || prix <= 0) return null;

  // « GLOSTAD Canapé, Knisa gris foncé » : le libellé de l'image porte le nom
  // complet, avec la finition. Le couple `name` + `typeName` seul donnerait
  // « GLOSTAD Canapé », qui ne distingue pas deux coloris.
  const titre = p.mainImageAlt?.trim() || [p.name, p.typeName].filter(Boolean).join(' ');
  if (!titre) return null;

  // Le fil d'Ariane decrit le produit mieux qu'un intitule de rayon : il sert
  // de descriptif a l'extraction des caracteristiques.
  const chemin = (p.categoryPath ?? [])
    .map((c) => c.name)
    .filter(Boolean)
    .join(' · ');

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

async function* parcourir(
  rayons: ReadonlyArray<readonly [string, string]>,
  ctx: CrawlContext,
): AsyncGenerator<RawProduct> {
  let emis = 0;

  for (const [code, slug] of rayons) {
    if (ctx.signal.aborted || emis >= ctx.limits.maxProducts) return;

    let data: IkeaResponse;
    try {
      data = await ctx.getJson<IkeaResponse>(`${API}?category=${code}&size=${TAILLE}`);
    } catch {
      continue; // un rayon indisponible ne doit pas interrompre les autres
    }

    const lot = data.productListPage?.productWindow ?? [];
    let pris = 0;
    for (const p of lot) {
      const raw = toRawProduct(p, slug);
      if (!raw) continue;
      yield raw;
      pris++;
      if (++emis >= ctx.limits.maxProducts) break;
    }
    if (pris > 0) ctx.log(`  ${code} (${slug}) -> ${pris} produits`);
  }
}

export const ikeaAdapter: StoreAdapter = {
  id: 'ikea-ca',

  // Pas de recherche : leur robots.txt interdit les URL de recherche du site,
  // et l'API de rayon suffit a couvrir le catalogue.
  capabilities: { deals: true, categories: true, search: false },

  categories: [...new Set(RAYONS.map(([, s]) => s))],

  async *listCategory(slug, ctx) {
    const cibles = RAYONS.filter(([, s]) => s === slug);
    if (cibles.length === 0) {
      ctx.log(`  (aucun rayon IKEA mappé pour "${slug}")`);
      return;
    }
    yield* parcourir(cibles, ctx);
  },

  async *listDeals(ctx) {
    yield* parcourir(RAYONS, ctx);
  },
};
