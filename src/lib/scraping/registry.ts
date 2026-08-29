import type { StoreMeta } from './types';
import { bestBuyAdapter } from './stores/bestbuy';
import { neweggAdapter } from './stores/newegg';

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
  },
  {
    id: 'canadiantire-ca',
    name: 'Canadian Tire',
    kind: 'retailer',
    country: 'CA',
    currency: 'CAD',
    homepage: 'https://www.canadiantire.ca',
    color: '#C8102E',
    requestsPerSecond: 1,
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
