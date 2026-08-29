import type { StoreAdapter, RawProduct, CrawlContext } from '../types';

/**
 * Costco Canada.
 *
 * ----------------------------------------------------------------------------
 * TROIS FAUSSES PISTES AVANT LA BONNE
 * ----------------------------------------------------------------------------
 *
 * 1. Le site a d'abord ete classe « bloque ». C'etait un FAUX POSITIF de notre
 *    detecteur : Costco sert 2,1 Mo sans le moindre defi anti-robot, et son
 *    robots.txt a toutes ses lignes `Disallow` commentees — rien n'est
 *    interdit.
 *
 * 2. Les pages de RAYON ne contiennent aucun prix : leur application charge la
 *    liste apres affichage, depuis `gdx-api.costco.com`. Cette API repond 401
 *    sans cle d'abonnement, et nous n'irons pas chercher cette cle dans leur
 *    page : franchir une barriere posee deliberement n'est pas la meme chose
 *    qu'utiliser un point d'entree ouvert.
 *
 * 3. Le sitemap cite dans robots.txt (`sitemap_lw_index`) ne liste que leurs
 *    entrepots. Il fallait ouvrir `sitemap_index.xml`, qui n'y figure pas.
 *
 * ----------------------------------------------------------------------------
 * LA VOIE OUVERTE
 * ----------------------------------------------------------------------------
 *
 * `sitemap_index.xml` -> `sitemap_p_001.xml` : 8 736 fiches produit. Et chaque
 * fiche publie un `Product` en JSON-LD complet — nom, marque, reference, prix,
 * disponibilite, note moyenne et nombre d'avis.
 *
 * C'est une requete par produit, ce qui est lent compare a une API de listing.
 * Mais c'est la page publique, servie a qui la demande, sans rien contourner.
 */

const BASE = 'https://www.costco.ca';

interface JsonLdProduct {
  '@type'?: string;
  name?: string;
  image?: string | string[];
  description?: string;
  sku?: string;
  url?: string;
  brand?: { name?: string } | string;
  aggregateRating?: { ratingValue?: number; ratingCount?: number };
  offers?: {
    price?: number | string;
    priceCurrency?: string;
    availability?: string;
  };
}

interface JsonLdBreadcrumb {
  '@type'?: string;
  itemListElement?: Array<{ name?: string; position?: number }>;
}

/** Tous les blocs JSON-LD d'une page, a plat. */
function blocsJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(
    /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const j = JSON.parse(m[1]);
      if (Array.isArray(j)) out.push(...j);
      else out.push(j);
    } catch {
      // Un bloc malforme ne doit pas empecher de lire les suivants.
    }
  }
  return out;
}

/**
 * Fil d'Ariane -> notre categorie.
 *
 * Meme discipline qu'ailleurs : motifs etroits, et un rayon non reconnu est
 * ignore. Un produit mal range fausse une categorie entiere.
 */
const REGLES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\btv\b|television|téléviseur/i, 'televiseurs'],
  [/laptop|notebook|portable/i, 'portables'],
  [/desktop|all-in-one|ordinateur de bureau/i, 'ordinateurs'],
  [/monitor|moniteur/i, 'moniteurs'],
  [/tablet|tablette/i, 'tablettes'],
  [/headphone|earbud|casque|écouteur/i, 'casques'],
  [/speaker|sound ?bar|audio|haut-parleur/i, 'audio'],
  [/camera|caméra|appareil photo/i, 'cameras'],
  [/printer|imprimante/i, 'imprimantes'],
  [/router|networking|réseau/i, 'reseau'],
  [/hard drive|ssd|storage|stockage/i, 'stockage'],
  [/smart home|maison intelligente|thermostat|doorbell/i, 'maison-intelligente'],
  [/refrigerator|freezer|washer|dryer|dishwasher|range|réfrigérateur|congélateur|laveuse|sécheuse|lave-vaisselle|cuisinière/i, 'gros-electro'],
  [/vacuum|aspirateur/i, 'aspirateurs'],
  [/coffee|blender|air fryer|microwave|toaster|kettle|cafetière|friteuse|micro-ondes/i, 'petits-electro'],
  [/mattress|matelas|bedding|literie|pillow|oreiller/i, 'literie'],
  [/sofa|sectional|recliner|canapé|fauteuil/i, 'salon'],
  [/dining|salle à manger/i, 'salle-a-manger'],
  [/bedroom|chambre/i, 'chambre'],
  [/office furniture|desk|bureau/i, 'bureau-meubles'],
  [/patio|outdoor|garden|jardin|extérieur/i, 'jardinage'],
  [/lighting|lamp|luminaire|lampe/i, 'luminaires'],
  [/cookware|kitchenware|dinnerware|cuisine|vaisselle/i, 'cuisine'],
  [/tool|outil|drill|perceuse/i, 'outils'],
  [/toy|jouet|game|jeu/i, 'jouets'],
  [/fitness|exercise|treadmill|entraînement/i, 'fitness'],
  [/mobile|cell phone|smartphone|téléphone/i, 'telephones'],
  [/watch|montre/i, 'montres'],
  [/baby|infant|bébé/i, 'bebe'],
  [/pet |animal/i, 'animaux'],
];

/** Types a ne jamais collecter : ce ne sont pas des produits comparables. */
const IGNORER =
  /gift card|carte-cadeau|membership|adhésion|warranty|garantie|travel|voyage|installation|service|photo center|pharmacy|optical|hearing/i;

function slugDepuisFil(fil: string[]): string | null {
  const texte = fil.join(' ');
  if (IGNORER.test(texte)) return null;
  // Du plus precis au plus general : le dernier niveau decrit le mieux.
  for (const niveau of [...fil].reverse()) {
    for (const [motif, slug] of REGLES) if (motif.test(niveau)) return slug;
  }
  return null;
}

const nombre = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};

export function extraireFiche(html: string, url: string): RawProduct | null {
  const blocs = blocsJsonLd(html);

  const prod = blocs.find(
    (b) => (b as JsonLdProduct)?.['@type'] === 'Product',
  ) as JsonLdProduct | undefined;
  if (!prod) return null;

  const prix = nombre(prod.offers?.price);
  if (!prix || !prod.name) return null;

  const fil = blocs.find(
    (b) => (b as JsonLdBreadcrumb)?.['@type'] === 'BreadcrumbList',
  ) as JsonLdBreadcrumb | undefined;
  const chemin = (fil?.itemListElement ?? [])
    .map((e) => e.name)
    .filter((n): n is string => Boolean(n));

  const slug = slugDepuisFil([...chemin, prod.name]);
  if (!slug) return null;

  const image = Array.isArray(prod.image) ? prod.image[0] : prod.image;
  const marque = typeof prod.brand === 'string' ? prod.brand : prod.brand?.name;
  const avis = prod.aggregateRating?.ratingCount ?? 0;

  // La reference marchand est dans l'URL : « ….product.4000444931.html ».
  const sku = url.match(/\.product\.(\d+)\.html/)?.[1] ?? prod.sku ?? url;

  return {
    sku,
    url,
    title: prod.name.trim(),
    brand: marque?.trim() || null,
    // `sku` du JSON-LD est le numero d'article Costco, celui qu'on donne en
    // magasin — pas toujours la reference du fabricant, mais stable.
    model: prod.sku?.trim() || null,
    imageUrl: image ?? null,
    imageUrls: image ? [image] : [],
    description: prod.description?.trim() || null,
    price: prix,
    // Costco n'affiche pas de prix barre dans son JSON-LD.
    listPrice: null,
    currency: prod.offers?.priceCurrency ?? 'CAD',
    inStock: prod.offers?.availability
      ? !/OutOfStock|SoldOut/i.test(prod.offers.availability)
      : null,
    rating: avis > 0 ? (prod.aggregateRating?.ratingValue ?? null) : null,
    ratingCount: avis > 0 ? avis : null,
    storeCategory: chemin[chemin.length - 1] ?? null,
    categorySlug: slug,
    condition: 'new',
    availability: 'les-deux',
    marketplace: false,
    sellerName: null,
  };
}

/** Les fiches produit, listees par leur propre sitemap. */
async function urlsProduit(ctx: CrawlContext): Promise<string[]> {
  const idx = await ctx.getText(`${BASE}/sitemap_index.xml`);
  const sousSitemaps = [...idx.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
    .map((m) => m[1])
    // « _p_ » designe les produits. Les autres listent rayons, entrepots,
    // pages editoriales — rien a collecter.
    .filter((u) => /sitemap_p_\d+\.xml/i.test(u));

  const urls: string[] = [];
  for (const s of sousSitemaps) {
    if (ctx.signal.aborted) break;
    try {
      const xml = await ctx.getText(s);
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        if (/\.product\.\d+\.html/.test(m[1])) urls.push(m[1]);
      }
    } catch {
      // Un sous-sitemap indisponible ne doit pas interrompre les autres.
    }
  }
  return urls;
}

/**
 * Nombre de fiches lues en meme temps.
 *
 * Le limiteur de debit espace les DEPARTS ; rien n'oblige a attendre la fin
 * d'une reponse avant de lancer la suivante. En sequentiel, une fiche a 330 ms
 * plafonnait la collecte a trois par seconde quoi qu'on regle. En parallele,
 * c'est la cadence declaree qui commande.
 */
const EN_PARALLELE = 12;

/** On s'arrete de lire des que le bloc produit est complet. */
const assezLu = (contenu: string): boolean => {
  const i = contenu.indexOf('"@type":"Product"');
  return i >= 0 && contenu.indexOf('</script>', i) >= 0;
};

async function* parcourir(ctx: CrawlContext, filtre?: string): AsyncGenerator<RawProduct> {
  const urls = await urlsProduit(ctx);
  ctx.log(`  ${urls.length} fiches produit listees par leur sitemap`);

  let emis = 0;
  let ignores = 0;
  let suivante = 0;

  // FILE CONTINUE, pas des vagues.
  //
  // Une premiere version lancait six requetes puis attendait la fin des six
  // avant de repartir : chaque tour durait celui de la fiche la plus lente, et
  // cinq lignes restaient a ne rien faire. Ici, des qu'une fiche est finie, la
  // suivante part — la cadence declaree redevient la seule limite.
  const enCours = new Map<number, Promise<{ i: number; raw: RawProduct | null }>>();

  const lancer = () => {
    while (enCours.size < EN_PARALLELE && suivante < urls.length) {
      const i = suivante++;
      const url = urls[i];
      enCours.set(
        i,
        (async () => {
          try {
            // Lecture ecourtee : le bloc utile finit au sixieme du document.
            const html = await ctx.getPartial(url, assezLu);
            return { i, raw: extraireFiche(html, url) };
          } catch {
            return { i, raw: null };
          }
        })(),
      );
    }
  };

  lancer();

  while (enCours.size > 0) {
    if (ctx.signal.aborted || emis >= ctx.limits.maxProducts) break;

    const { i, raw } = await Promise.race(enCours.values());
    enCours.delete(i);
    lancer();

    if (!raw) {
      ignores++;
      continue;
    }
    if (filtre && raw.categorySlug !== filtre) continue;

    yield raw;
    emis++;
    if (emis % 200 === 0) ctx.log(`  … ${emis} produits retenus (${ignores} ecartes)`);
  }
}

export const costcoAdapter: StoreAdapter = {
  id: 'costco-ca',

  // Une requete par fiche : la recherche n'apporterait rien de plus.
  capabilities: { deals: true, categories: true, search: false },

  categories: [...new Set(REGLES.map(([, s]) => s))],

  async *listCategory(slug, ctx) {
    yield* parcourir(ctx, slug);
  },

  async *listDeals(ctx) {
    yield* parcourir(ctx);
  },
};
