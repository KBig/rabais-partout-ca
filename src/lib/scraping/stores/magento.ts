import type { StoreAdapter, RawProduct, CrawlContext } from '../types';
import { pageDeReprise, avancerCurseur } from '../core/curseur';

/**
 * Les marchands sous Magento, par leur point d'entree GraphQL de vitrine.
 *
 * ----------------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE
 * ----------------------------------------------------------------------------
 *
 * Canadian Tire a servi de lecon. Son catalogue de 174 000 articles ne se lit
 * qu'a travers un navigateur, vingt-quatre produits par page, avec dix secondes
 * imposees entre deux requetes : vingt heures pour un seul passage. J'ai passe
 * des heures a reordonner ses rayons pour gagner quelques pourcents sur une
 * limite qui n'est pas la notre.
 *
 * Pendant ce temps, six enseignes de la liste — Canac, Structube, Tanguay,
 * Dormez-vous, Linen Chest, Ricardo — attendaient d'etre branchees. Une
 * signature dans leur page d'accueil les designe toutes comme des boutiques
 * Magento, et Magento publie un point d'entree GraphQL de vitrine : celui que
 * leur propre site interroge, qui ne demande aucune clef, et qui rend cinq
 * cents produits par requete en une seconde.
 *
 * Deux d'entre elles le laissent ouvert. Le catalogue entier de Structube tient
 * en six requetes, celui de Linen Chest en vingt. Six secondes contre vingt
 * heures : le gain n'est pas venu d'une optimisation, mais d'avoir regarde
 * ailleurs.
 *
 * ----------------------------------------------------------------------------
 * CE QU'ON DEMANDE, ET CE QU'ON NE FORCE PAS
 * ----------------------------------------------------------------------------
 *
 * La requete ne demande que ce que la fiche publique affiche deja : nom, prix,
 * prix regulier, image, rayon, disponibilite, note.
 *
 * Un marchand dont l'endpoint repond 401, 404 ou 405 n'est PAS force : il a
 * ferme sa vitrine, et on s'en tient la. Meme regle que pour l'API interne de
 * Canadian Tire, qui repond 401 et le restera.
 */

export interface MagentoStoreConfig {
  id: string;
  /** Racine du site, sans barre finale. */
  base: string;
  /** Rayon Magento vers notre categorie. Premiere regle qui matche. */
  rules: ReadonlyArray<readonly [RegExp, string]>;
  /** Rayons a ignorer entierement (cartes-cadeaux, services, garanties). */
  ignore?: readonly RegExp[];
  /**
   * Suffixe des adresses de fiche. Magento le rend dans `url_suffix`, mais
   * certaines boutiques laissent ce champ vide et servent des adresses nues.
   */
  suffixe?: string;
}

/**
 * Produits par requete.
 *
 * Mesure sur les deux boutiques : 100, 300 et 500 passent toutes, en une
 * seconde environ. On s'arrete a 300 — le gain au-dela est nul, et une requete
 * plus legere est plus polie envers un serveur qu'on ne connait pas.
 */
const PAR_PAGE = 300;

/** Garde-fou : au-dela, c'est qu'on tourne en rond. */
const PAGES_MAX = 200;

interface MagentoProduit {
  sku?: string;
  name?: string;
  url_key?: string;
  url_suffix?: string | null;
  stock_status?: string;
  categories?: Array<{ name?: string; url_path?: string; level?: number }>;
  image?: { url?: string } | null;
  small_image?: { url?: string } | null;
  price_range?: {
    minimum_price?: {
      final_price?: { value?: number; currency?: string };
      regular_price?: { value?: number };
    };
  };
  rating_summary?: number | null;
  review_count?: number | null;
}

const REQUETE = (page: number) =>
  `{ products(filter: {}, pageSize: ${PAR_PAGE}, currentPage: ${page}) {` +
  ` total_count page_info { total_pages }` +
  ` items { sku name url_key url_suffix stock_status` +
  ` categories { name url_path level }` +
  ` image { url } small_image { url }` +
  ` price_range { minimum_price { final_price { value currency } regular_price { value } } }` +
  ` rating_summary review_count } } }`;

/** Le rayon le plus profond decrit le mieux ce qu'est l'objet. */
const duPlusPrecis = (p: MagentoProduit) =>
  [...(p.categories ?? [])].sort((a, b) => (b.level ?? 0) - (a.level ?? 0));

/**
 * Rattache un produit a l'une de NOS categories.
 *
 * Magento rend l'arborescence complete, du rayon general a la feuille. On
 * essaie de la plus PRECISE a la plus generale : « Ice Makers and Trays » dit
 * mieux ce qu'est l'objet que « Tabletop & Bar ». Le titre sert de dernier
 * recours, comme chez Shopify ou le type declare est souvent vide.
 */
function slugDe(p: MagentoProduit, cfg: MagentoStoreConfig): string | null {
  const rayons = duPlusPrecis(p).flatMap((c) => [c.name ?? '', c.url_path ?? '']);

  for (const motif of cfg.ignore ?? []) {
    if (rayons.some((r) => motif.test(r)) || motif.test(p.name ?? '')) return null;
  }

  for (const source of [...rayons, p.name ?? '']) {
    if (!source) continue;
    for (const [motif, slug] of cfg.rules) if (motif.test(source)) return slug;
  }
  return null;
}

function versRawProduct(
  p: MagentoProduit,
  cfg: MagentoStoreConfig,
  slug: string,
): RawProduct | null {
  const prix = p.price_range?.minimum_price?.final_price?.value;
  if (!prix || prix <= 0 || !p.name || !p.sku) return null;

  const regulier = p.price_range?.minimum_price?.regular_price?.value ?? null;
  const image = p.image?.url ?? p.small_image?.url ?? null;
  const rayon = duPlusPrecis(p)[0];

  return {
    sku: p.sku,
    url: `${cfg.base}/${p.url_key}${p.url_suffix ?? cfg.suffixe ?? ''}`,
    title: p.name,
    brand: null,
    model: null,
    imageUrl: image,
    imageUrls: image ? [image] : [],
    description: null,
    price: prix,
    // Un « regulier » egal au prix paye n'annonce aucun rabais. Le passer tel
    // quel ferait afficher une baisse de zero pour cent, ce qui encombre la
    // fiche sans rien apprendre.
    listPrice: regulier && regulier > prix ? regulier : null,
    currency: p.price_range?.minimum_price?.final_price?.currency ?? 'CAD',
    inStock: p.stock_status ? p.stock_status === 'IN_STOCK' : null,
    // Magento note sur cent, nous sur cinq.
    rating: p.rating_summary ? Math.round((p.rating_summary / 20) * 10) / 10 : null,
    ratingCount: p.review_count || null,
    storeCategory: rayon?.url_path ?? rayon?.name ?? null,
    categorySlug: slug,
    condition: 'new',
    availability: 'les-deux',
    marketplace: false,
    sellerName: null,
  };
}

async function* parcourir(
  cfg: MagentoStoreConfig,
  ctx: CrawlContext,
  filtre?: string,
): AsyncGenerator<RawProduct> {
  // Le curseur ne sert qu'au parcours COMPLET : une collecte filtree sur une
  // categorie vise autre chose et ne doit pas deplacer l'avancement general.
  const suivi = !filtre;
  let page = suivi ? pageDeReprise(cfg.id).page : 1;
  let fin = false;
  let emis = 0;
  const parSlug = new Map<string, number>();

  try {
    for (; page <= PAGES_MAX; page++) {
      if (ctx.signal.aborted || emis >= ctx.limits.maxProducts) return;

      const reponse = await ctx.getJson<{
        data?: { products?: { page_info?: { total_pages?: number }; items?: MagentoProduit[] } };
        errors?: Array<{ message?: string }>;
      }>(`${cfg.base}/graphql?query=${encodeURIComponent(REQUETE(page))}`);

      if (reponse.errors?.length) {
        ctx.log(`  refus du marchand : ${reponse.errors[0]?.message?.slice(0, 90)}`);
        return;
      }

      const lot = reponse.data?.products?.items ?? [];
      if (lot.length === 0) {
        fin = true;
        return;
      }

      for (const p of lot) {
        const slug = slugDe(p, cfg);
        if (!slug) continue;
        if (filtre && slug !== filtre) continue;

        const brut = versRawProduct(p, cfg, slug);
        if (!brut) continue;

        parSlug.set(slug, (parSlug.get(slug) ?? 0) + 1);
        yield brut;
        emis++;
      }

      // Derniere page annoncee : inutile d'en demander une de plus pour
      // s'entendre repondre qu'elle est vide.
      const total = reponse.data?.products?.page_info?.total_pages ?? 0;
      if (total > 0 && page >= total) {
        fin = true;
        page++; // celle-ci a bien ete lue
        return;
      }
    }
  } finally {
    // `finally` parce qu'un generateur abandonne par son consommateur — budget
    // epuise, temps ecoule — ne repasse pas par la fin du corps. C'est
    // precisement le cas ou l'avancement doit etre retenu.
    if (suivi && !ctx.signal.aborted) avancerCurseur(cfg.id, '', page, fin);

    for (const [slug, n] of [...parSlug].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      ctx.log(`  ${slug} -> ${n} produits`);
    }
  }
}

export function createMagentoAdapter(cfg: MagentoStoreConfig): StoreAdapter {
  return {
    id: cfg.id,
    capabilities: { deals: true, categories: true, search: false },
    categories: [...new Set(cfg.rules.map(([, s]) => s))],
    listDeals: (ctx) => parcourir(cfg, ctx),
    listCategory: (slug, ctx) => parcourir(cfg, ctx, slug),
  };
}
