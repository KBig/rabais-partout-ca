import type { EnrichmentSource, EnrichedFacts, ProductRef, EnrichmentHttp } from '../types';

/**
 * PRIX CONSTRUCTEUR — extracteur générique.
 *
 * ----------------------------------------------------------------------------
 * POURQUOI UN SEUL EXTRACTEUR PLUTÔT QUE 200 ADAPTATEURS
 * ----------------------------------------------------------------------------
 *
 * Le prix publié par un fabricant est l'ancre de référence la plus fiable qui
 * existe : c'est le prix fixé par celui qui le fixe. Mais il y a des centaines
 * de marques — Samsung, Dell, Apple, Dyson, Ninja, DeWalt, Frigidaire… — et
 * écrire un scraper par marque serait ingérable.
 *
 * La quasi-totalité des sites marchands publient pourtant leurs fiches en
 * **JSON-LD schema.org** : un bloc `<script type="application/ld+json">`
 * contenant un `Product` et ses `offers`. C'est un format NORMALISÉ. Un seul
 * extracteur le lit chez toutes les marques qui le respectent ; chaque marque
 * n'apporte plus qu'une information propre — comment atteindre la fiche à
 * partir d'un numéro de modèle.
 *
 * ----------------------------------------------------------------------------
 * CE QUI A ÉTÉ VÉRIFIÉ, ET CE QUI NE MARCHE PAS
 * ----------------------------------------------------------------------------
 *
 *   Samsung  — 6 blocs JSON-LD, prix extrait correctement.
 *   Dell     — 11 blocs, AUCUN prix produit : leur fiche charge le tarif en
 *              JavaScript après affichage. Le JSON-LD seul ne suffit pas.
 *
 * Autrement dit, l'approche générique couvre une partie des marques, pas
 * toutes. Chaque marque doit être vérifiée avant d'être activée — d'où le
 * champ `verified` ci-dessous, qui empêche d'interroger un site dont on n'a
 * pas confirmé qu'il expose un prix lisible.
 */

/** Le prix constructeur fait autorité, mais l'appariement par modèle peut se tromper. */
const MANUFACTURER_CONFIDENCE = 0.88;

export interface BrandSite {
  /** Marque telle qu'elle apparaît dans nos données, en minuscules. */
  brand: string;
  name: string;
  /** Gabarit d'URL de recherche ; `{model}` est remplacé par le modèle. */
  searchUrl: string;
  /**
   * A-t-on CONSTATÉ que ce site publie un prix lisible en JSON-LD ?
   *
   * Faux par défaut : sans vérification, on ne dépense pas de requêtes sur un
   * site dont on ignore s'il répondra. Passer une marque à `true` demande
   * d'avoir ouvert une de ses fiches et confirmé la présence du prix.
   */
  verified: boolean;
}

/**
 * Sites fabricants connus. Ajouter une marque = une ligne, pas un fichier.
 *
 * Seules les marques `verified` sont interrogées. Les autres attendent une
 * vérification manuelle — c'est volontairement conservateur : interroger un
 * site qui ne répondra jamais gaspille des requêtes et pollue les journaux.
 */
export const BRAND_SITES: BrandSite[] = [
  {
    brand: 'samsung',
    name: 'Samsung',
    searchUrl: 'https://www.samsung.com/ca_fr/search/?searchvalue={model}',
    verified: true,
  },
  { brand: 'lg', name: 'LG', searchUrl: 'https://www.lg.com/ca_fr/search/?search={model}', verified: false },
  { brand: 'dell', name: 'Dell', searchUrl: 'https://www.dell.com/fr-ca/search/{model}', verified: false },
  { brand: 'apple', name: 'Apple', searchUrl: 'https://www.apple.com/ca/fr/search/{model}', verified: false },
  { brand: 'sony', name: 'Sony', searchUrl: 'https://www.sony.ca/fr/search?q={model}', verified: false },
  { brand: 'lenovo', name: 'Lenovo', searchUrl: 'https://www.lenovo.com/ca/fr/search?text={model}', verified: false },
  { brand: 'hp', name: 'HP', searchUrl: 'https://www.hp.com/ca-fr/search?q={model}', verified: false },
  { brand: 'dyson', name: 'Dyson', searchUrl: 'https://www.dysoncanada.ca/fr/search?q={model}', verified: false },
  { brand: 'bose', name: 'Bose', searchUrl: 'https://www.bose.ca/fr_ca/search.html?q={model}', verified: false },
  { brand: 'philips', name: 'Philips', searchUrl: 'https://www.philips.ca/fr/search?q={model}', verified: false },
];

const BY_BRAND = new Map(BRAND_SITES.map((b) => [b.brand, b]));

/**
 * Extrait un prix d'une page HTML via son JSON-LD.
 *
 * On parcourt récursivement chaque bloc plutôt que de supposer une structure :
 * les sites imbriquent `offers` de façons très variées (objet, tableau,
 * `AggregateOffer`), et une lecture rigide casserait à la première variante.
 */
export function extractJsonLdPrice(html: string): { price: number; name: string | null } | null {
  const blocks = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];

  let price: number | null = null;
  let name: string | null = null;

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const o = node as Record<string, unknown>;

    if (o['@type'] === 'Product' && typeof o.name === 'string' && !name) {
      name = o.name;
    }
    for (const champ of ['price', 'lowPrice', 'highPrice']) {
      const v = o[champ];
      const n = typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : v;
      // On retient le PREMIER prix rencontré : les blocs suivants décrivent
      // généralement des accessoires ou des produits recommandés.
      if (price === null && typeof n === 'number' && Number.isFinite(n) && n > 0) {
        price = n;
      }
    }
    Object.values(o).forEach(walk);
  };

  for (const b of blocks) {
    try {
      walk(JSON.parse(b[1]));
    } catch {
      // Un bloc malformé ne doit pas empêcher de lire les suivants.
    }
  }

  return price !== null ? { price, name } : null;
}

/**
 * Source d'enrichissement : va chercher le prix officiel du fabricant.
 *
 * Implémentée comme SOURCE plutôt que comme adaptateur de magasin, parce que
 * l'accès est par modèle et non par rayon : on ne parcourt pas le catalogue
 * d'un constructeur, on lui pose une question sur un produit précis. Ça réutilise
 * la file de priorité, la mesure d'accord et le signal de référence déjà en place.
 */
export const manufacturerPriceSource: EnrichmentSource = {
  id: 'manufacturer-price',
  reliability: MANUFACTURER_CONFIDENCE,

  supports(p: ProductRef) {
    if (!p.brand || !p.model || p.model.length < 4) return false;
    const site = BY_BRAND.get(p.brand.toLowerCase().trim());
    return Boolean(site?.verified);
  },

  async fetch(p: ProductRef, http: EnrichmentHttp): Promise<EnrichedFacts | null> {
    const site = BY_BRAND.get(p.brand!.toLowerCase().trim());
    if (!site?.verified) return null;

    const url = site.searchUrl.replace('{model}', encodeURIComponent(p.model!));
    const html = await http.getText(url);
    const found = extractJsonLdPrice(html);
    if (!found) return null;

    // Garde-fou : un prix constructeur très inférieur au prix détaillant
    // signale presque toujours qu'on est tombé sur un accessoire, pas sur le
    // produit. Mieux vaut ne rien affirmer que d'ancrer la référence à côté.
    if (p.currentPrice && found.price < p.currentPrice * 0.35) return null;

    return {
      manufacturerPrice: found.price,
      manufacturerName: site.name,
      manufacturerUrl: url,
    };
  },
};
