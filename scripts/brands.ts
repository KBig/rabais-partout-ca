/**
 * Étiquette chaque produit avec la marque déclarée par le marchand.
 *
 *   npm run brands                 (toutes les marques)
 *   npm run brands -- --only 30    (les 30 premières, pour tester)
 *   npm run brands -- --rediscover (relire les sitemaps du marchand)
 *
 * Sans marque, aucun prix constructeur n'est atteignable : c'est la première
 * moitié de la clé, le modèle étant la seconde. Avant cette passe, la marque
 * était connue sur 894 produits sur 279 603.
 *
 * À relancer après une collecte, et rarement ensuite : un produit ne change
 * pas de marque.
 */
import { migrate } from '../src/lib/db/index';
import { HttpClient } from '../src/lib/scraping/core/http';
import { getStore } from '../src/lib/scraping/registry';
import { harvestBrands } from '../src/lib/scraping/stores/bestbuy-brands';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

migrate();

const storeId = arg('store') ?? 'bestbuy-ca';
const store = getStore(storeId);
const only = arg('only') ? Number(arg('only')) : undefined;

const controller = new AbortController();
process.on('SIGINT', () => {
  console.log('\nInterruption demandée — le travail déjà écrit est conservé.');
  controller.abort();
});

const http = new HttpClient({ requestsPerSecond: store.requestsPerSecond });
const debut = Date.now();

const res = await harvestBrands(storeId, http, (m) => console.log(m), {
  signal: controller.signal,
  only,
  rediscover: process.argv.includes('--rediscover'),
  mine: !process.argv.includes('--no-mine'),
});

const secondes = ((Date.now() - debut) / 1000).toFixed(0);
console.log(
  `\n✓ ${res.brands} marques vues, ${res.resolved} actives, ` +
    `${res.labelled} produits étiquetés en ${secondes} s (${http.requestCount} requêtes).`,
);
