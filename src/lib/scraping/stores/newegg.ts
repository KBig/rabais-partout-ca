import type { StoreAdapter, RawProduct, CrawlContext } from '../types';
import { pageDeReprise, avancerCurseur, curseursDe, parCouverture } from '../core/curseur';
import { NEWEGG_SUBCATEGORIES } from './newegg-categories';

/**
 * Newegg Canada — deuxième détaillant.
 *
 * ----------------------------------------------------------------------------
 * POURQUOI CELUI-LÀ
 * ----------------------------------------------------------------------------
 *
 * Le deuxième magasin n'est pas là pour ajouter des produits : il est là pour
 * permettre des COMPARAISONS. Un catalogue qui ne recoupe pas le premier
 * n'apporte aucune comparaison, seulement du volume.
 *
 * Newegg vend presque exactement ce que Best Buy vend le plus — portables,
 * composants, moniteurs, stockage, périphériques — et ses titres portent des
 * numéros de modèle, ce qui rend le rapprochement entre magasins réellement
 * possible.
 *
 * Walmart aurait été le choix évident. Il a été écarté après vérification :
 * son robots.txt interdit son API et sa recherche, et ses fiches produit
 * redirigent vers une page « Verify Your Identity ». Costco pose le même type
 * de défi ; Memory Express et Staples répondent 403. Contourner une détection
 * de robots n'est pas une option, et un site qui refuse se respecte.
 *
 * ----------------------------------------------------------------------------
 * CE QUE LEUR robots.txt AUTORISE
 * ----------------------------------------------------------------------------
 *
 * Trois `Disallow: /` figurent dans leur fichier, mais ils visent trois robots
 * NOMMÉS — ChangeDetection, 008 et Nutch — pas le groupe `*`. Pour tout le
 * monde, seuls sont interdits des chemins d'administration, quelques appels
 * d'API, et les paramètres de tri `SortType`, `Order` et `isdeptsrh` sur les
 * pages de listing. Ces trois-là ne sont jamais employés ici.
 *
 * ----------------------------------------------------------------------------
 * COMMENT ON LIT LEURS PAGES
 * ----------------------------------------------------------------------------
 *
 * Chaque page de rayon embarque son état complet dans `__initialState__` : un
 * JSON contenant `Products[]` avec prix, prix régulier, marque, modèle, note,
 * stock et images. Aucune API privée n'est sollicitée — on lit la page qui
 * nous est servie.
 */

const BASE = 'https://www.newegg.ca';

/** Newegg sert 36 articles par page, sans paramètre pour en demander plus. */
const PAGE_SIZE = 36;

/** Repete ici : le curseur s'ecrit avant que l'adaptateur ne soit construit. */
const NEWEGG_ID = 'newegg-ca';

/**
 * Mur de pagination, mesuré.
 *
 * Les pages 1, 2, 30, 60 et 90 renvoient des produits tous distincts ; la
 * page 120 ne renvoie que des doublons. Comme chez Best Buy, le total annoncé
 * dépasse largement ce qui est réellement atteignable : 11 682 portables
 * annoncés pour 3 600 accessibles. La réponse est la même — descendre dans les
 * sous-rayons plutôt que paginer dans le vide.
 */
const PAGE_CAP = 100;

/**
 * Rayons ECARTES, avant toute tentative de rattachement.
 *
 * Le rattachement par mots-cles est efficace mais naif, et il produisait de
 * vraies erreurs : « Blood Pressure Monitors » atterrissait dans les moniteurs
 * d'ordinateur, « Food Processors » dans les composants PC, « Pro Auto
 * Controller System Processor » aussi. Un ecran professionnel a 7 800 $ se
 * retrouvait compare a des moniteurs de bureau.
 *
 * Ces rayons sont donc ecartes explicitement. Trois familles :
 *
 *   MEDICAL ET INDUSTRIEL — rien a voir avec le grand public, et des prix qui
 *   deformeraient toute comparaison.
 *
 *   PROFESSIONNEL — affichage commercial, point de vente, serveurs. Meme
 *   remarque : ce ne sont pas des substituts des produits domestiques.
 *
 *   ACCESSOIRES d'un appareil. Une housse a 30 $ dans le rayon « portables »
 *   fausse la mediane de categorie et le classement. Best Buy les couvre deja ;
 *   mieux vaut un catalogue plus petit et juste.
 */
const IGNORER: readonly RegExp[] = [
  /blood pressure|thermometer|medical|nebulizer|hearing aid/i,
  /industrial|semiconductor|sensor|transducer|test measurement|transformer|signal (routing|boost)|switches relays|optoelectronic|circuit|soldering/i,
  /commercial|point of sale|\bpos\b|pole display|digital signage|kiosk|post monitoring|control switch/i,
  /\bserver\b|rackmount|\brack\b|enterprise|workstation graphic/i,
  /accessor|\bcable|adapter|\bcase bag\b|cooling pad|replacement (part|screen)|batteries|power cord|mount|stand|bracket|screen protector|cleaning|warranty|installation/i,
];

/**
 * Intitulé de rayon Newegg → notre catégorie.
 *
 * L'ORDRE COMPTE : la première règle qui matche gagne, donc les intitulés les
 * plus spécifiques passent d'abord. Une table de mots-clés plutôt que 921
 * correspondances écrites à la main : elle traite les rayons ajoutés depuis,
 * et se relit en une minute.
 *
 * Les motifs sont volontairement ETROITS. Un rayon non reconnu est ignore,
 * ce qui coute quelques produits ; un rayon mal reconnu pollue une categorie
 * entiere, ses statistiques et ses classements.
 */
const SLUG_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // --- informatique --------------------------------------------------------
  [/^(all )?laptop$|^2 in 1 laptop$|^gaming laptops?$|^business laptops?$|^chromebook$|^notebooks pads$/i, 'portables'],
  [/^(gaming )?(desktop|pc)s?$|^all in one|^mini pc|^barebone|^desktop computer/i, 'ordinateurs'],
  [/^computer monitor$|^gaming monitor$|^portable monitor$/i, 'moniteurs'],
  [/^(internal |external )?(ssd|hard drive|hdd)|^desktop nas$|^usb flash|^memory card|^portable (ssd|hard)/i, 'stockage'],
  [/^(desktop|laptop) memory$|^video card|^graphic card|^(desktop|mobile) cpu|^(amd|intel) motherboard|^motherboard|^power supplies$|^computer case|^cpu (air|liquid) cooler|^case fan|^sound card|^optical drive/i, 'composants'],
  [/^(laser|inkjet|all in one) printer|^printer$|^scanner|^toner|^ink cartridge/i, 'imprimantes'],
  [/^wireless router|^wired router|^network (interface|switch)|^switches$|^wireless (ap|adapter|range)|^whole home mesh|^powerline|^modem/i, 'reseau'],

  // --- jeu vidéo -----------------------------------------------------------
  [/^gaming (keyboard|mice|mouse|headset|chair|desk)|^game controller|^joystick|^racing wheel/i, 'accessoires-gaming'],
  [/^playstation|^ps5|^ps4/i, 'playstation'],
  [/^xbox/i, 'xbox'],
  [/^nintendo/i, 'nintendo'],
  [/^vr |virtual reality/i, 'realite-virtuelle'],

  // --- électronique --------------------------------------------------------
  [/^led tv$|^tv combos$|^oled tv|^smart tv/i, 'televiseurs'],
  [/^headphones$|^wired headsets|^earbuds|^headsets$/i, 'casques'],
  [/^(home audio |portable |pa )?speakers$|^sound ?bars?$|^receivers$|^turntables|^microphones$|^stereo shelf/i, 'audio'],
  [/^(dslr|point shoot|compact mirrorless|tough|action|film) camera|^camcorder|^camera lenses$|^drone/i, 'cameras'],
  [/^thermostats$|^smart (lock|light|plug)|^video doorbell|^security camera/i, 'maison-intelligente'],

  // --- mobile --------------------------------------------------------------
  [/^tablets$/i, 'tablettes'],
  [/^smart ?watch|^wearable technology$|^fitness tracker/i, 'montres'],
  [/^cell phones/i, 'telephones'],

  // --- électroménager et maison -------------------------------------------
  [/vacuum(?!.*accessor)/i, 'aspirateurs'],
  [/^refrigerators$|^freezers$|^washers$|^dryers$|^dishwasher|^range hood|^stove cooktop|^ovens?$|^air conditioner/i, 'gros-electro'],
  [/^(automatic )?coffee (maker|grinder)|^blenders$|^toasters?$|^microwave|^air fryer|^teakettle|^rice cooker|^food processor|^juicer|^waffles/i, 'petits-electro'],
  [/^cookware|^bakeware|^dinnerware|^cutlery|^knives$/i, 'cuisine'],
  [/^(office |gaming )?(desks?|chairs?)$|^bookcase|^shelving$/i, 'meubles'],
  [/^(led )?(light bulbs?|lamps?)$|^ceiling (fan|light)|^flashlight/i, 'luminaires'],
  [/^mattress|^pillows$|^bedding|^blankets$/i, 'literie'],

  // --- divers --------------------------------------------------------------
  [/^power tools?$|^hand tools?$|^drills?$|^saws?$|^wrench/i, 'outils'],
  [/^lawn|^garden|^snow blower|^pressure washer/i, 'jardinage'],
  [/^toys$|^puzzles$|^building (block|set)|^board games?$/i, 'jouets'],
  [/^dash cam|^car (audio|video|electronics)|^tires$/i, 'auto'],
  [/^treadmill|^exercise bike|^dumbbell|^yoga/i, 'fitness'],
];

/** Rattache un intitulé Newegg à l'une de nos catégories, ou à rien. */
export function slugPourRayon(nom: string): string | null {
  // Les exclusions passent AVANT : un rayon medical, industriel, professionnel
  // ou d'accessoires ne doit jamais rejoindre une categorie grand public, meme
  // si son intitule contient le bon mot.
  for (const motif of IGNORER) if (motif.test(nom)) return null;

  for (const [motif, slug] of SLUG_RULES) {
    if (motif.test(nom)) return slug;
  }
  return null;
}

/**
 * Notre catégorie → rayons Newegg correspondants.
 *
 * Construit une fois au chargement du module, à partir de la table de
 * mots-clés : aucune liste d'identifiants à tenir à jour.
 */
export const CATEGORY_MAP: Record<string, number[]> = (() => {
  const m: Record<string, number[]> = {};
  for (const [id, nom] of NEWEGG_SUBCATEGORIES) {
    const slug = slugPourRayon(nom);
    if (!slug) continue;
    (m[slug] ??= []).push(id);
  }
  return m;
})();

/** Rayons les plus fournis, pour la passe « rabais ». */
const DEALS_CATEGORIES = [
  'portables',
  'composants',
  'moniteurs',
  'stockage',
  'ordinateurs',
  'accessoires-gaming',
  'reseau',
  'televiseurs',
];

// ---------------------------------------------------------------------------
// Lecture de l'état de page
// ---------------------------------------------------------------------------

interface NeweggItemCell {
  Item: string;
  UnitCost?: number;
  FinalPrice?: number;
  LowestPrice30Days?: number | null;
  Instock?: boolean;
  Model?: string | null;
  Description?: { Title?: string; IMDescription?: string | null } | null;
  ItemManufactory?: { Manufactory?: string | null } | null;
  Review?: { Rating?: number | null; HumanRating?: number | null } | null;
  Seller?: { SellerId?: string | null; SellerName?: string | null } | null;
  Image?: { Normal?: { ImageName?: string | null } | null } | null;
  NewImage?: { ImageName?: string | null } | null;
  Type?: number;
}

interface NeweggState {
  Products?: Array<{ ItemCell?: NeweggItemCell }>;
  TotalItemCount?: number;
}

/**
 * Extrait l'état JSON de la page.
 *
 * On borne la recherche à l'affectation suivie de la fermeture du script :
 * l'état fait un demi-mégaoctet et une expression trop gourmande avalerait la
 * moitié du document.
 */
export function extractState(html: string): NeweggState | null {
  const m = html.match(/__initialState__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as NeweggState;
  } catch {
    return null;
  }
}

/** Les images vivent sur leur CDN, en plusieurs tailles. */
function imageCandidates(nom: string | null | undefined): string[] {
  if (!nom) return [];
  return [
    `https://c1.neweggimages.com/productimage/nb1280/${nom}`,
    `https://c1.neweggimages.com/ProductImageCompressAll1280/${nom}`,
    `https://c1.neweggimages.com/productimage/nb640/${nom}`,
  ];
}

const CONDITION_MOTIFS: ReadonlyArray<readonly [RegExp, RawProduct['condition']]> = [
  [/\brefurbish|recertified|renewed\b/i, 'refurbished'],
  [/\bopen box\b|\bopen-box\b/i, 'open-box'],
];

function detectCondition(titre: string): RawProduct['condition'] {
  for (const [motif, etat] of CONDITION_MOTIFS) if (motif.test(titre)) return etat;
  return 'new';
}

function toRawProduct(c: NeweggItemCell, categorySlug: string): RawProduct | null {
  const titre = c.Description?.Title?.trim();
  const prix = c.FinalPrice;
  if (!c.Item || !titre || typeof prix !== 'number' || prix <= 0) return null;

  const regulier = typeof c.UnitCost === 'number' ? c.UnitCost : null;
  const image = c.Image?.Normal?.ImageName ?? c.NewImage?.ImageName ?? null;
  const images = imageCandidates(image);

  // Newegg compte les avis dans `HumanRating` et la note dans `Rating`. Une
  // note sans avis ne veut rien dire : on ne retient le couple que complet.
  const avis = c.Review?.HumanRating ?? 0;
  const note = avis > 0 ? (c.Review?.Rating ?? null) : null;

  const vendeur = c.Seller?.SellerName?.trim() || null;

  return {
    sku: String(c.Item),
    url: `${BASE}/p/${c.Item}`,
    title: titre,
    brand: c.ItemManufactory?.Manufactory?.trim() || null,
    model: c.Model?.trim() || null,
    imageUrl: images[0] ?? null,
    imageUrls: images,
    description: c.Description?.IMDescription?.trim() || null,
    price: prix,
    // Le « régulier » n'est retenu que s'il dépasse réellement le prix payé.
    listPrice: regulier && regulier > prix ? regulier : null,
    currency: 'CAD',
    inStock: c.Instock ?? null,
    rating: note,
    ratingCount: avis > 0 ? avis : null,
    storeCategory: null,
    categorySlug,
    condition: detectCondition(titre),
    // Newegg est un pure-player : tout part d'un entrepôt, rien d'un magasin.
    availability: 'en-ligne',
    marketplace: Boolean(vendeur),
    sellerName: vendeur,
  };
}

/** Parcourt un rayon, page après page, jusqu'au mur ou à la fin. */
async function* crawlSubcategory(
  id: number,
  slug: string,
  ctx: CrawlContext,
  restant: { produits: number; pages: number },
): AsyncGenerator<RawProduct> {
  const vus = new Set<string>();

  /**
   * ON REPREND OU LE PASSAGE PRECEDENT S'EST ARRETE.
   *
   * Repartir de la page 1 a chaque cycle voulait dire ne relever que la tete
   * de chaque rayon. Sur 23 000 produits, la queue n'avait aucun releve de
   * prix — et rien ne le signalait, puisque le passage se terminait « ok ».
   */
  let page = pageDeReprise(NEWEGG_ID, String(id)).page;
  let fin = false;

  try {
    for (; page <= PAGE_CAP; page++) {
      if (ctx.signal.aborted || restant.pages <= 0 || restant.produits <= 0) return;

      const url = `${BASE}/x/SubCategory/ID-${id}${page > 1 ? `?page=${page}` : ''}`;
      let html: string;
      try {
        html = await ctx.getText(url);
      } catch {
        return; // un rayon momentanément indisponible ne doit pas tout arrêter
      }
      restant.pages--;

      const etat = extractState(html);
      const produits = etat?.Products ?? [];
      if (produits.length === 0) {
        fin = true;
        return;
      }

      let nouveaux = 0;
      for (const p of produits) {
        const c = p.ItemCell;
        if (!c) continue;
        if (vus.has(c.Item)) continue;
        vus.add(c.Item);
        nouveaux++;

        const raw = toRawProduct(c, slug);
        if (!raw) continue;
        yield raw;
        if (--restant.produits <= 0) return;
      }

      // Passé le mur, Newegg resert les mêmes articles. Une page entièrement
      // composée de doublons signale qu'on tourne en rond : on s'arrête là
      // plutôt que de dépenser des requêtes pour rien.
      //
      // Les deux cas signifient « rayon epuise » : le curseur repart de la
      // page 1 au prochain tour, sans quoi il resterait bloque sur une page
      // qui ne rend plus rien.
      if (nouveaux === 0 || page * PAGE_SIZE >= (etat?.TotalItemCount ?? 0)) {
        fin = true;
        page++; // la page courante a bien ete lue
        return;
      }
    }
    fin = true; // mur de pagination atteint
  } finally {
    // `finally` parce qu'un generateur abandonne par son consommateur — budget
    // epuise, temps ecoule — ne repasse pas par la fin du corps. C'est
    // precisement le cas ou l'avancement doit etre retenu.
    avancerCurseur(NEWEGG_ID, String(id), page, fin);
  }
}

async function* crawlIds(
  ids: number[],
  slug: string,
  ctx: CrawlContext,
): AsyncGenerator<RawProduct> {
  const restant = { produits: ctx.limits.maxProducts, pages: ctx.limits.maxPages };

  // Du MOINS couvert au plus couvert : un rayon deja termine ne doit pas
  // reprendre le budget avant que ses voisins aient ete vus une seule fois.
  for (const id of parCouverture(ids, (i) => String(i), curseursDe(NEWEGG_ID))) {
    if (ctx.signal.aborted || restant.produits <= 0 || restant.pages <= 0) return;
    const avant = restant.produits;
    yield* crawlSubcategory(id, slug, ctx, restant);
    const pris = avant - restant.produits;
    if (pris > 0) ctx.log(`  rayon ${id} -> ${pris} produits`);
  }
}

export const neweggAdapter: StoreAdapter = {
  id: 'newegg-ca',

  capabilities: { deals: true, categories: true, search: true },

  categories: Object.keys(CATEGORY_MAP),

  async *listCategory(slug, ctx) {
    const ids = CATEGORY_MAP[slug];
    if (!ids?.length) {
      ctx.log(`  (aucun rayon Newegg mappé pour "${slug}")`);
      return;
    }
    ctx.log(`  ${ids.length} sous-rayon(s) Newegg pour ${slug}`);
    yield* crawlIds(ids, slug, ctx);
  },

  async *listDeals(ctx) {
    const dispo = DEALS_CATEGORIES.filter((s) => CATEGORY_MAP[s]?.length);
    const parCategorie = Math.max(200, Math.floor(ctx.limits.maxProducts / dispo.length));
    const pagesPar = Math.max(2, Math.floor(ctx.limits.maxPages / dispo.length));

    for (const slug of dispo) {
      if (ctx.signal.aborted) return;
      ctx.log(`- ${slug}`);
      yield* crawlIds(CATEGORY_MAP[slug], slug, {
        ...ctx,
        limits: { maxProducts: parCategorie, maxPages: pagesPar },
      });
    }
  },

  /**
   * Recherche texte.
   *
   * `?d=` est le paramètre de recherche de Newegg. Les paramètres de tri sont
   * volontairement absents : leur robots.txt les interdit.
   */
  async *search(query, ctx) {
    let emis = 0;

    for (let page = 1; page <= Math.min(PAGE_CAP, ctx.limits.maxPages); page++) {
      if (ctx.signal.aborted) return;

      const url = `${BASE}/p/pl?d=${encodeURIComponent(query)}&page=${page}`;
      const etat = extractState(await ctx.getText(url));
      const produits = etat?.Products ?? [];
      if (produits.length === 0) return;

      for (const p of produits) {
        if (!p.ItemCell) continue;
        const raw = toRawProduct(p.ItemCell, 'electronique');
        if (!raw) continue;
        yield raw;
        if (++emis >= ctx.limits.maxProducts) return;
      }
    }
  },
};
