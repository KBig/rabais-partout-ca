/**
 * CLI d'enrichissement : va chercher les informations manquantes.
 *
 *   npm run enrich -- --store bestbuy-ca --limit 150
 */
import { migrate } from '../src/lib/db/index';
import { enrichStore } from '../src/lib/enrichment/runner';
import { getStore, liveStores } from '../src/lib/scraping/registry';
import { scoreAll } from '../src/lib/pricing/score';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const store = getStore(arg('store') ?? liveStores()[0].id);
const limit = Number(arg('limit') ?? 150);

const controller = new AbortController();
process.on('SIGINT', () => {
  console.log('\nInterruption demandée…');
  controller.abort();
});

migrate();
const started = Date.now();

const res = await enrichStore({
  storeId: store.id,
  limit,
  signal: controller.signal,
  log: (m) => console.log(m),
});

console.log(
  `\n${res.attempted} tentés — ${res.ok} complets, ${res.partial} partiels, ` +
    `${res.failed} échecs, ${res.requests} requêtes.`,
);

if (res.ok + res.partial > 0) {
  console.log('Recalcul des scores…');
  console.log(`${scoreAll()} scores mis à jour.`);
}
console.log(`Terminé en ${((Date.now() - started) / 1000).toFixed(1)}s.`);
