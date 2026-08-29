import type { EnrichmentSource, EnrichedFacts, ProductRef, EnrichmentHttp } from '../types';
import { findManufacturerUrl } from './sitemap';

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
 *
 * ----------------------------------------------------------------------------
 * LE VRAI OBSTACLE : LA DÉCOUVERTE, PAS L'EXTRACTION
 * ----------------------------------------------------------------------------
 *
 * Test de bout en bout sur trois modèles Samsung : aucun prix trouvé. Pourtant
 * l'extraction JSON-LD fonctionne parfaitement sur une fiche produit DIRECTE
 * (vérifié : 2 099,99 $ correctement lus).
 *
 * L'obstacle est en amont. Les pages de RECHERCHE des fabricants sont rendues
 * en JavaScript : le numéro de modèle n'apparaît même pas dans le HTML servi,
 * et aucun lien produit n'est suivable. Passer d'un modèle à l'URL de sa fiche
 * demande donc, selon le site :
 *
 *   - un gabarit d'URL prévisible (le plus simple quand il existe) ;
 *   - un navigateur sans interface pour exécuter la recherche ;
 *   - une API officielle.
 *
 * Aucune de ces trois voies n'est générique. L'EXTRACTION l'est ; la DÉCOUVERTE
 * demande du travail par marque. C'est une contrainte du terrain, pas un défaut
 * d'implémentation — et mieux vaut le savoir que d'activer des marques qui ne
 * renverront jamais rien.
 */

/** Le prix constructeur fait autorité, mais l'appariement par modèle peut se tromper. */
const MANUFACTURER_CONFIDENCE = 0.88;

export interface BrandSite {
  /** Marque telle qu'elle apparaît dans nos données, en minuscules. */
  brand: string;
  name: string;
  /**
   * Sitemap racine du site. C'est par lui que passe la DECOUVERTE des fiches :
   * du XML statique, publie pour etre parcouru, qui liste les pages produit.
   * Le moteur de recherche du site, lui, est rendu en JavaScript et inutilisable.
   */
  sitemapUrl?: string;
  /**
   * Motif que doivent respecter les URL retenues du sitemap.
   *
   * Les fabricants publient un sitemap MONDIAL. Sans filtre, on indexe des
   * fiches africaines ou asiatiques dont la page n'affiche aucun prix
   * canadien — et le plafond de sitemaps est atteint avant d'arriver au bon
   * pays, l'index etant trie alphabetiquement.
   */
  urlFilter?: string;
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
    // La decouverte passe par le sitemap, pas par la recherche du site.
    // Verifie : 36 de nos 40 modeles Samsung y sont retrouves.
    sitemapUrl: 'https://www.samsung.com/ca_fr/sitemap.xml',
    verified: true,
  },
  {
    brand: 'sony',
    name: 'Sony',
    searchUrl: 'https://www.sony.ca/fr/search?q={model}',
    sitemapUrl: 'https://www.sony.ca/sitemap.xml',
    urlFilter: '/fr/',
    // Verifie : fiche /fr/audio/... -> 1 bloc JSON-LD, prix 24,99 $ extrait.
    verified: true,
  },
  {
    brand: 'bose',
    name: 'Bose',
    searchUrl: 'https://www.bose.ca/fr_ca/search.html?q={model}',
    sitemapUrl: 'https://www.bose.ca/sitemap_index.xml',
    urlFilter: '/p/',
    // Verifie : fiche /fr/p/sets/... -> 3 blocs JSON-LD, prix 548 $ extrait.
    verified: true,
  },
  {
    brand: 'asus',
    name: 'ASUS',
    searchUrl: 'https://www.asus.com/ca-en/search?q={model}',
    sitemapUrl: 'https://www.asus.com/sitemap.xml',
    // Indispensable ici : l'index mondial commence par « africa-fr ».
    urlFilter: '/ca-en/',
    // Verifie : fiche /ca-en/motherboards-components/... -> prix 59,99 $ extrait.
    verified: true,
  },

  // --------------------------------------------------------------------------
  // Non verifiees. Chacune a ete TESTEE et a echoue pour une raison precise ;
  // les activer depenserait des requetes pour ne jamais rien rapporter.
  // --------------------------------------------------------------------------
  // LG      : fiches ca_fr servies avec du JSON-LD sans prix.
  // Dell    : fiche produit servie, 3 blocs, prix charge en JavaScript ensuite.
  // Acer    : les fiches ca-en repondent 403 a une requete automatisee.
  // Lenovo  : pages canadiennes sans JSON-LD produit.
  // Apple   : le sitemap /shop ne renvoie aucune URL exploitable.
  // Dyson   : sitemap en 403.
  { brand: 'lg', name: 'LG', searchUrl: 'https://www.lg.com/ca_fr/search/?search={model}', verified: false },
  { brand: 'dell', name: 'Dell', searchUrl: 'https://www.dell.com/fr-ca/search/{model}', verified: false },
  { brand: 'apple', name: 'Apple', searchUrl: 'https://www.apple.com/ca/fr/search/{model}', verified: false },
  { brand: 'lenovo', name: 'Lenovo', searchUrl: 'https://www.lenovo.com/ca/fr/search?text={model}', verified: false },
  { brand: 'hp', name: 'HP', searchUrl: 'https://www.hp.com/ca-fr/search?q={model}', verified: false },
  { brand: 'dyson', name: 'Dyson', searchUrl: 'https://www.dysoncanada.ca/fr/search?q={model}', verified: false },
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

    // On passe par l'index de sitemap : il donne l'URL EXACTE de la fiche.
    // La recherche du site ne sert que de repli, et n'aboutit presque jamais.
    const url = findManufacturerUrl(site.brand, p.model!);
    if (!url) return null;

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
