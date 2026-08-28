/**
 * CLI de crawl.
 *
 *   npm run crawl -- --store bestbuy-ca --deals
 *   npm run crawl -- --store bestbuy-ca --category televiseurs
 *   npm run crawl -- --store bestbuy-ca --search "airpods"
 *   npm run crawl -- --store bestbuy-ca --all          (toutes ses catégories)
 */
import { migrate } from '../src/lib/db/index';
import { seedReferenceData } from '../src/lib/db/seed';
import { crawl, retireStaleProducts } from '../src/lib/scraping/core/pipeline';
import { getStore, liveStores } from '../src/lib/scraping/registry';
import { scoreAll } from '../src/lib/pricing/score';
import { syncManufacturerReferences } from '../src/lib/enrichment/msrp';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const storeId = arg('store') ?? liveStores()[0]?.id;
if (!storeId) {
  console.error('Aucun magasin disponible.');
  process.exit(1);
}

const store = getStore(storeId);
const maxProducts = Number(arg('max-products') ?? 4000);
const maxPages = Number(arg('max-pages') ?? 60);

// Ctrl+C interrompt proprement : le lot en cours est écrit avant de sortir.
const controller = new AbortController();
process.on('SIGINT', () => {
  console.log('\nInterruption demandée, on termine le lot en cours…');
  controller.abort();
});

const log = (m: string) => console.log(m);

async function run() {
  migrate();
  seedReferenceData();

  const started = Date.now();
  const category = arg('category');
  const query = arg('search');

  const jobs: Array<{ strategy: 'deals' | 'category' | 'search'; target?: string }> = [];

  if (query) jobs.push({ strategy: 'search', target: query });
  else if (category) jobs.push({ strategy: 'category', target: category });
  else if (flag('all')) {
    for (const slug of store.adapter?.categories ?? []) {
      jobs.push({ strategy: 'category', target: slug });
    }
  } else jobs.push({ strategy: 'deals' });

  console.log(`\n${store.name} — ${jobs.length} tâche(s), ${store.requestsPerSecond} req/s\n`);

  let totals = { seen: 0, created: 0, priceChanges: 0, requests: 0 };

  for (const job of jobs) {
    if (controller.signal.aborted) break;
    const label = job.target ? `${job.strategy}:${job.target}` : job.strategy;
    console.log(`▸ ${label}`);

    const res = await crawl({
      storeId: store.id,
      strategy: job.strategy,
      target: job.target,
      maxProducts,
      maxPages,
      signal: controller.signal,
      log,
    });

    totals.seen += res.seen;
    totals.created += res.created;
    totals.priceChanges += res.priceChanges;
    totals.requests += res.requests;

    console.log(
      `  ${res.status} — ${res.seen} vus, ${res.created} nouveaux, ` +
        `${res.priceChanges} changements de prix, ${res.requests} requêtes` +
        (res.error ? `\n  ⚠ ${res.error}` : ''),
    );
  }

  const retired = retireStaleProducts(store.id);
  if (retired) console.log(`\n${retired} produit(s) marqué(s) inactifs (non revus depuis 14 j).`);

  // Les prix constructeurs alimentent le signal de reference : ce
  // rapprochement doit preceder le calcul des scores. Purement local,
  // aucune requete reseau.
  const msrp = syncManufacturerReferences();
  if (msrp.written > 0) {
    console.log(`
${msrp.written} prix de reference constructeur rapproches.`);
  }

  console.log('\nCalcul des scores…');
  const scored = scoreAll();

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `\n✓ Terminé en ${secs}s — ${totals.seen} produits traités, ` +
      `${totals.created} nouveaux, ${totals.priceChanges} changements, ` +
      `${totals.requests} requêtes, ${scored} scores calculés.`,
  );
}

run().catch((err) => {
  console.error('\nErreur fatale :', err);
  process.exit(1);
});
