import type { StoreAdapter, RawProduct, CrawlContext } from '../types';
import { renderer, closeRenderer } from '../core/renderer';

/**
 * Canadian Tire.
 *
 * ----------------------------------------------------------------------------
 * LE SEUL MAGASIN QUI EXIGE UN NAVIGATEUR
 * ----------------------------------------------------------------------------
 *
 * Tous les autres publient leurs données par une voie légère : une API de
 * listing, un état embarqué, un point d'entrée ouvert, ou du JSON-LD sur
 * chaque fiche. Canadian Tire n'offre aucune des quatre.
 *
 * Leurs pages sont entièrement construites côté client. Leurs fiches produit
 * ne portent qu'un JSON-LD d'en-tête et de pied de page — vérifié, aucun
 * `Product`. Et leur API, que leur propre page appelle, répond 401 sans clé
 * d'abonnement. Cette clé est visible dans leur page ; je ne l'y prends pas.
 *
 * Reste à VISITER la page, comme n'importe quel client. Le navigateur exécute
 * leur code dans leur contexte : rien n'est détourné.
 *
 * ----------------------------------------------------------------------------
 * CE QUI REND CELA RAPIDE MALGRE TOUT
 * ----------------------------------------------------------------------------
 *
 * Leur robots.txt demande dix secondes entre deux requêtes. Une fiche à la
 * fois donnerait 8 640 produits par jour — inutilisable pour 50 000 articles.
 *
 * On collecte donc par RAYON : une page rendue en porte jusqu'à quatre-vingt-
 * dix. Le même délai rapporte alors quatre-vingt-dix fois plus. Et le rendu
 * bloque images, polices et mouchards : seul le HTML nous intéresse.
 */

const BASE = 'https://www.canadiantire.ca';

/**
 * Ils demandent `Crawl-delay: 10`. On le respecte à la lettre.
 *
 * Le débit du client HTTP ne s'applique pas ici : le rendu ne passe pas par
 * lui. Ce délai est donc tenu à la main, entre deux pages.
 */
const DELAI_MS = 10_000;

/** Au-delà, un rayon est soit épuisé, soit en train de se répéter. */
const PAGES_MAX = 25;

const sommeil = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Chemin de rayon → notre catégorie.
 *
 * Leurs URL portent la hiérarchie complète — « /cat/sports-recreation/
 * fitness-exercise-DC0002121.html ». Motifs étroits, et un rayon non reconnu
 * est ignoré : un produit mal rangé fausse toute une catégorie.
 */
const REGLES: ReadonlyArray<readonly [RegExp, string]> = [
  [/fitness|exercise|gym|entrainement/i, 'fitness'],
  [/tires|pneus/i, 'pneus'],
  [/auto-?parts|automotive\/.*part|pieces-auto|batteries-maintenance/i, 'pieces-auto'],
  [/car-electronics|dash-cam|audio-video-auto/i, 'audio-auto'],
  [/automotive/i, 'auto'],
  [/power-?tools|outils-electriques|drill|saw/i, 'outils-electriques'],
  [/hand-?tools|outils-a-main/i, 'outils-main'],
  [/hardware|quincaillerie|fastener/i, 'quincaillerie'],
  [/tools|outils/i, 'outils'],
  [/lawn|garden|jardin|snow-?blower|pressure-?washer/i, 'jardinage'],
  [/camping|fishing|hunting|peche|chasse/i, 'camping'],
  [/bike|cycling|velo/i, 'velo'],
  [/winter-?sport|ski|hockey|patin/i, 'sports-hiver'],
  [/sports-recreation|sport/i, 'sport'],
  [/kitchen|cookware|dinnerware|cuisine|vaisselle/i, 'cuisine'],
  [/small-?appliance|petits-electro|coffee|blender|air-?fryer/i, 'petits-electro'],
  [/major-?appliance|gros-electro|refriger|washer|dryer/i, 'gros-electro'],
  [/vacuum|aspirateur/i, 'aspirateurs'],
  [/bedding|literie|mattress|matelas/i, 'literie'],
  [/furniture|meuble/i, 'meubles'],
  [/lighting|luminaire|lamp/i, 'luminaires'],
  [/decor|decoration/i, 'decoration'],
  [/storage|organization|rangement/i, 'rangement'],
  [/pet|animal/i, 'animaux'],
  [/toy|jouet|game|jeu/i, 'jouets'],
  [/baby|bebe/i, 'bebe'],
  [/paint|peinture/i, 'quincaillerie'],
  [/electronics|electronique/i, 'electronique'],
];

/** Rayons à ne jamais collecter : ce ne sont pas des produits comparables. */
const IGNORER =
  /gift-?card|carte-cadeau|service|installation|warranty|garantie|triangle|rewards|financ|clearance-events|flyer|circulaire/i;

export function slugPourChemin(url: string): string | null {
  if (IGNORER.test(url)) return null;
  for (const [motif, slug] of REGLES) if (motif.test(url)) return slug;
  return null;
}

/**
 * Lit un prix ecrit dans l'une ou l'autre langue.
 *
 *   anglais  « $1,299.99 »  — virgule de milliers, point decimal
 *   francais « 1 299,99 $ » — espace de milliers, virgule decimale
 */
export function prixCanadien(brut: string): number | null {
  // « 10,99&nbsp;$ » : l'espace insecable arrive sous forme d'ENTITE, pas de
  // caractere. Une premiere version ne retirait que le caractere, et tous les
  // prix francais devenaient illisibles — zero produit, sans erreur.
  const t = brut
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/[  ]/g, ' ');

  // Premier montant rencontre : « 1 299,99 » ou « 1,299.99 ». Les separateurs
  // de milliers sont l'espace ou la virgule selon la langue ; les deux derniers
  // chiffres apres la derniere ponctuation sont les cents.
  const m = t.match(/(\d{1,3}(?:[\s,.]\d{3})*[.,]\d{2})/);
  if (!m) return null;

  const brutNombre = m[1].replace(/\s/g, '');
  const dec = brutNombre.slice(-3);
  const entier = brutNombre.slice(0, -3).replace(/[.,]/g, '');
  const n = Number(`${entier}.${dec.slice(1)}`);

  return Number.isFinite(n) && n > 0 ? n : null;
}

const nettoie = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Extrait les produits d'une page de rayon RENDUE.
 *
 * On lit le HTML plutôt que d'interroger le DOM : l'extraction devient
 * testable sans navigateur, et le rendu n'a plus qu'un seul rôle — produire ce
 * HTML.
 */
export function extraireCartes(html: string, slug: string): RawProduct[] {
  const out: RawProduct[] = [];
  const vus = new Set<string>();

  // ON PART DU PRIX, ET ON REMONTE.
  //
  // Une premiere version decoupait le HTML sur les liens de fiche. Mauvaise
  // idee : leur grille imbrique des liens DANS les cartes — image, titre,
  // apercu rapide — si bien qu'une carte donnait plusieurs blocs, l'un avec le
  // titre, l'autre avec le prix, aucun avec les deux. Cinquante-trois cartes
  // sur soixante-sept se perdaient ainsi.
  //
  // Le prix, lui, n'apparait qu'une fois par carte. En partant de lui et en
  // remontant vers le lien et le titre les plus proches, le rattachement est
  // sans ambiguite quelle que soit l'imbrication.
  const FENETRE = 4000;

  for (const m of html.matchAll(/data-testid="priceTotal"[^>]*>([\s\S]{0,240})/gi)) {
    const prix = prixCanadien(m[1]);
    if (!prix) continue;

    const avant = html.slice(Math.max(0, m.index! - FENETRE), m.index!);

    // Le DERNIER lien de fiche avant ce prix est celui de sa carte.
    const liens = [...avant.matchAll(/href="(\/[a-z]{2}\/pdp\/[^"]+)"/gi)];
    const chemin = liens[liens.length - 1]?.[1];
    if (!chemin) continue;

    const id = chemin.match(/-(\d+)p\.html/)?.[1];
    if (!id || vus.has(id)) continue;

    // Tout ce qui suit le lien de la carte : c'est son perimetre propre.
    const depuisLien = avant.slice(liens[liens.length - 1].index ?? 0);

    const titres = [
      ...avant.matchAll(
        /class="[^"]*nl-product-card__title[^"]*"[^>]*>([\s\S]{0,400}?)<\/div>/gi,
      ),
    ];
    const titreBrut = titres[titres.length - 1]?.[1];
    const titre = titreBrut ? nettoie(titreBrut) : '';
    if (titre.length < 5) continue;

    // La marque est en gras a l'interieur du titre.
    const marque = titreBrut?.match(/nl-product__brand--bold[^>]*>([^<]{2,40})</i)?.[1]?.trim();

    const images = [
      ...avant.matchAll(/<img[^>]+src="(https:\/\/media-www\.canadiantire\.ca\/[^"]+)"/gi),
    ];
    const image = images[images.length - 1]?.[1];
    const imagePropre = image ? image.replace(/[?&](wid|hei)=\d+/g, '') : null;

    vus.add(id);
    out.push({
      sku: id,
      url: `${BASE}${chemin}`,
      title: titre,
      brand: marque || null,
      // La reference marchand apparait sous la forme « 184-1862-4 ».
      //
      // Cherchee UNIQUEMENT apres le lien de cette carte : prise sur toute la
      // fenetre, elle ramenait celle de la carte precedente, et deux produits
      // differents se retrouvaient avec le meme numero.
      model: depuisLien.match(/(\d{3}-\d{4}-\d)(?!\d)/)?.[1] ?? null,
      imageUrl: imagePropre,
      imageUrls: imagePropre ? [imagePropre] : [],
      description: null,
      price: prix,
      // Leur prix barre n'est pas rendu de facon fiable sur la carte : mieux
      // vaut ne rien annoncer que d'annoncer un rabais faux.
      listPrice: null,
      currency: 'CAD',
      inStock: null,
      rating: null,
      ratingCount: null,
      storeCategory: null,
      categorySlug: slug,
      condition: 'new',
      availability: 'les-deux',
      marketplace: false,
      sellerName: null,
    });
  }

  return out;
}

/** Les rayons, listes par leur propre sitemap. */
async function rayons(ctx: CrawlContext): Promise<Array<{ url: string; slug: string }>> {
  const xml = await ctx.getText(`${BASE}/sitemap_Category-fr_CA-CAD.xml`);
  const out: Array<{ url: string; slug: string }> = [];

  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const url = m[1];
    if (!/\/cat\//.test(url)) continue;
    const slug = slugPourChemin(url);
    if (slug) out.push({ url, slug });
  }
  return out;
}

async function* parcourir(ctx: CrawlContext, filtre?: string): AsyncGenerator<RawProduct> {
  const tous = await rayons(ctx);
  const cibles = filtre ? tous.filter((r) => r.slug === filtre) : tous;
  ctx.log(`  ${cibles.length} rayon(s) retenus sur ${tous.length} publiés`);

  const rendu = renderer();
  let emis = 0;

  try {
    for (const { url, slug } of cibles) {
      if (ctx.signal.aborted || emis >= ctx.limits.maxProducts) break;

      const vusRayon = new Set<string>();

      for (let page = 1; page <= PAGES_MAX; page++) {
        if (ctx.signal.aborted || emis >= ctx.limits.maxProducts) break;

        const adresse = page === 1 ? url : `${url}?page=${page}`;
        let vues: string[];
        try {
          vues = await rendu.snapshots(adresse, {
            attendre: 'a[href*="/pdp/"]',
            defiler: true,
            // Seules les cartes nous interessent : le reste de la page pese
            // dix fois plus et faisait planter le navigateur.
            fragment: 'a[href*="/pdp/"]',
          });
        } catch (err) {
          // Un echec de rendu doit se VOIR. Une premiere version l'avalait en
          // silence : vingt-quatre rayons echouaient sans un mot, et la
          // collecte se terminait sur « 0 produit » sans rien expliquer.
          ctx.log(`  ⚠ ${slug} p.${page} : ${(err as Error).message.slice(0, 90)}`);
          break;
        }

        // Chaque instantane ne montre qu'une partie de la grille : on les
        // fusionne, la deduplication par SKU faisant le tri.
        const lot = vues.flatMap((v) => extraireCartes(v, slug));
        const parSku = new Map(lot.map((p) => [p.sku, p]));
        const nouveaux = [...parSku.values()].filter((p) => !vusRayon.has(p.sku));
        if (nouveaux.length === 0) break; // page vide ou repetition : rayon fini

        for (const p of nouveaux) {
          vusRayon.add(p.sku);
          yield p;
          if (++emis >= ctx.limits.maxProducts) break;
        }

        // Le delai qu'ils demandent, tenu entre deux pages.
        await sommeil(DELAI_MS);
      }

      if (vusRayon.size > 0) ctx.log(`  ${slug} ← ${vusRayon.size} produits`);
    }
  } finally {
    await closeRenderer();
  }
}

export const canadianTireAdapter: StoreAdapter = {
  id: 'canadiantire-ca',

  capabilities: { deals: true, categories: true, search: false },

  categories: [...new Set(REGLES.map(([, s]) => s))],

  async *listCategory(slug, ctx) {
    yield* parcourir(ctx, slug);
  },

  async *listDeals(ctx) {
    yield* parcourir(ctx);
  },
};
