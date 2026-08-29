import type { StoreMeta } from './types';
import { bestBuyAdapter } from './stores/bestbuy';
import { neweggAdapter } from './stores/newegg';
import {
  createShopifyAdapter,
  REGLES_MAISON,
  IGNORER_MAISON,
} from './stores/shopify';

/**
 * Registre des sources de prix.
 *
 * Deux familles, aux rôles distincts (voir `StoreKind` dans types.ts) :
 *
 *  - Les DÉTAILLANTS fournissent des offres à comparer entre elles.
 *  - Les FABRICANTS fournissent le prix de référence, publié par celui qui le
 *    fixe. C'est l'ancre la plus fiable qui existe pour juger un rabais, et
 *    elle est gratuite — là où une estimation tirée d'articles de blog est
 *    approximative, non datée, et limitée aux produits vedettes.
 *
 * Toutes les sources sont déclarées dès maintenant : celles SANS `adapter` sont
 * visibles dans l'interface avec le statut « bientôt disponible ». Ajouter une
 * source = écrire un fichier dans stores/ puis brancher `adapter` ici.
 *
 * `requestsPerSecond` est volontairement conservateur. Un scraper poli tient
 * des années ; un scraper agressif se fait bloquer en une après-midi.
 */
export const STORES: StoreMeta[] = [
  // ---------------------------------------------------------------- détaillants
  {
    id: 'bestbuy-ca',
    name: 'Best Buy',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.bestbuy.ca',
    color: '#0046BE',
    requestsPerSecond: 1.5,
    adapter: bestBuyAdapter,
  },
  {
    id: 'newegg-ca',
    name: 'Newegg',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.newegg.ca',
    color: '#F7A21D',
    // Leur robots.txt ne declare aucun Crawl-delay pour le groupe « * ».
    // On reste sous la cadence de Best Buy : leurs pages font 1 Mo, contre
    // quelques dizaines de kilo-octets pour une reponse d'API.
    requestsPerSecond: 1,
    adapter: neweggAdapter,
  },
  {
    id: 'ikea-ca',
    name: 'IKEA',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.ikea.com/ca/fr/',
    color: '#0058A3',
    requestsPerSecond: 1,
  },
  {
    id: 'walmart-ca',
    name: 'Walmart',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.walmart.ca',
    color: '#0071CE',
    requestsPerSecond: 0.5,
    blocked:
      'Deux refus distincts. Leurs fiches produit redirigent vers un défi ' +
      '« Verify Your Identity », et leur robots.txt interdit API et recherche. ' +
      'Surtout, les conditions de leur API officielle excluent explicitement ' +
      'son usage « par des concurrents pour analyser les prix ou la ' +
      'disponibilité » — ce qui vise précisément un comparateur. Même la porte ' +
      'officielle est fermée à cet usage.',
  },
  {
    id: 'canadiantire-ca',
    name: 'Canadian Tire',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.canadiantire.ca',
    color: '#C8102E',
    // Leur robots.txt demande 10 s entre deux requetes. On les respecte : cela
    // borne la collecte a environ 8 600 produits par jour.
    requestsPerSecond: 0.1,
  },
  {
    id: 'costco-ca',
    name: 'Costco',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.costco.ca',
    color: '#005DAA',
    requestsPerSecond: 0.5,
  },
  {
    id: 'amazon-ca',
    name: 'Amazon',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.amazon.ca',
    color: '#FF9900',
    requestsPerSecond: 0.25,
  },
  {
    id: 'winners-ca',
    name: 'Winners',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.winners.ca',
    color: '#E4002B',
    requestsPerSecond: 0.5,
  },
  {
    id: 'memoryexpress-ca',
    name: 'Memory Express',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.memoryexpress.com',
    color: '#00A94F',
    requestsPerSecond: 0.75,
    blocked:
      'Répond 403 même avec des en-têtes de navigation complets. Une partie de ' +
      'leur catalogue reste accessible : ils vendent aussi sur Newegg, que nous ' +
      'collectons.',
  },

  {
    id: 'brick-ca',
    name: 'Brick',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.thebrick.com',
    color: '#D6001C',
    requestsPerSecond: 0.75,
    adapter: createShopifyAdapter({
      id: 'brick-ca',
      base: 'https://www.thebrick.com',
      rules: REGLES_MAISON,
      ignore: IGNORER_MAISON,
    }),
  },
  {
    id: 'leons-ca',
    name: "Leon's",
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.leons.ca',
    color: '#E31837',
    requestsPerSecond: 0.75,
    adapter: createShopifyAdapter({
      id: 'leons-ca',
      base: 'https://www.leons.ca',
      rules: REGLES_MAISON,
      ignore: IGNORER_MAISON,
    }),
  },
  {
    id: 'tanguay-ca',
    name: 'Tanguay',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.tanguay.ca',
    color: '#003DA5',
    requestsPerSecond: 0.75,
  },
  {
    id: 'structube-ca',
    name: 'Structube',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.structube.com',
    color: '#1A1A1A',
    requestsPerSecond: 0.75,
  },
  {
    id: 'wayfair-ca',
    name: 'Wayfair',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.wayfair.ca',
    color: '#7F187F',
    requestsPerSecond: 0.5,
  },
  {
    id: 'galeriedumeuble-ca',
    name: 'Galerie du Meuble',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.galeriedumeuble.com',
    color: '#8B6F47',
    requestsPerSecond: 0.75,
  },
  {
    id: 'meublezvous-ca',
    name: 'Meublez-Vous',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.meublez-vous.ca',
    color: '#C8102E',
    requestsPerSecond: 0.75,
  },
  {
    id: 'dormezvous-ca',
    name: 'Dormez-vous',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.dormezvous.com',
    color: '#00539B',
    requestsPerSecond: 0.75,
  },
  {
    id: 'canac-ca',
    name: 'Canac',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.canac.ca',
    color: '#00833E',
    requestsPerSecond: 0.75,
  },
  {
    id: 'linenchest-ca',
    name: 'Linen Chest',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.linenchest.com',
    color: '#4A4A4A',
    requestsPerSecond: 0.75,
  },
  {
    id: 'stokes-ca',
    name: 'Stokes',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.stokesstores.com',
    color: '#E30613',
    requestsPerSecond: 0.75,
  },
  {
    id: 'ricardo-ca',
    name: 'Ricardo',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://boutique.ricardocuisine.com',
    color: '#E4002B',
    requestsPerSecond: 0.75,
  },
  {
    id: 'homesense-ca',
    name: 'HomeSense',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.homesense.ca',
    color: '#00447C',
    requestsPerSecond: 0.5,
  },
  {
    id: 'marshalls-ca',
    name: 'Marshalls',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.marshalls.ca',
    color: '#0033A0',
    requestsPerSecond: 0.5,
  },

  // ---------------------------------------------------------------- fabricants
  // Leur prix n'est pas une offre concurrente : c'est le PDSF, l'ancre de
  // référence. C'est la source la plus fiable pour juger un rabais, et elle ne
  // coûte rien.
  {
    id: 'apple-ca',
    name: 'Apple',
    kind: 'manufacturer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.apple.com/ca/fr/',
    color: '#555555',
    requestsPerSecond: 0.5,
  },
  {
    id: 'dell-ca',
    name: 'Dell',
    kind: 'manufacturer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.dell.com/fr-ca',
    color: '#007DB8',
    requestsPerSecond: 0.5,
  },
  {
    id: 'samsung-ca',
    name: 'Samsung',
    kind: 'manufacturer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.samsung.com/ca_fr/',
    color: '#1428A0',
    requestsPerSecond: 0.5,
  },
  {
    id: 'lg-ca',
    name: 'LG',
    kind: 'manufacturer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.lg.com/ca_fr',
    color: '#A50034',
    requestsPerSecond: 0.5,
  },
  {
    id: 'lenovo-ca',
    name: 'Lenovo',
    kind: 'manufacturer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.lenovo.com/ca/fr/',
    color: '#E2231A',
    requestsPerSecond: 0.5,
  },
  {
    id: 'hp-ca',
    name: 'HP',
    kind: 'manufacturer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.hp.com/ca-fr/',
    color: '#0096D6',
    requestsPerSecond: 0.5,
  },
];

export const STORE_BY_ID = new Map(STORES.map((s) => [s.id, s]));

/** Sources réellement crawlables aujourd'hui. */
export const liveStores = () => STORES.filter((s) => s.adapter);

export const retailers = () => STORES.filter((s) => s.kind === 'retailer');

/** Fabricants : leur prix sert d'ancre de référence, pas d'offre concurrente. */
export const manufacturers = () => STORES.filter((s) => s.kind === 'manufacturer');

export const isManufacturer = (storeId: string) =>
  STORE_BY_ID.get(storeId)?.kind === 'manufacturer';

export function getStore(id: string): StoreMeta {
  const s = STORE_BY_ID.get(id);
  if (!s) {
    throw new Error(
      `Source inconnue : "${id}". Disponibles : ${STORES.map((x) => x.id).join(', ')}`,
    );
  }
  return s;
}
