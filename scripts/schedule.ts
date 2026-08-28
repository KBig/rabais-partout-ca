/**
 * Ordonnanceur : boucle longue durée qui entretient la base toute seule.
 *
 *   npm run schedule
 *
 * Le rythme est délibérément lent. L'objectif n'est PAS d'avoir des prix à la
 * seconde près, mais d'accumuler un historique long et régulier — c'est lui qui
 * donne sa valeur au score. Un passage toutes les 6 heures produit ~4 points
 * d'observation par jour, largement assez pour dater un changement de prix, et
 * assez discret pour ne jamais peser sur les serveurs des marchands.
 *
 * Trois tâches alternent :
 *   1. crawl    — relever les prix (rapide, peu de requêtes)
 *   2. enrich   — combler les informations manquantes (plus lent)
 *   3. score    — recalculer les classements
 */
import { migrate } from '../src/lib/db/index';
import { seedReferenceData } from '../src/lib/db/seed';
import { crawl, retireStaleProducts } from '../src/lib/scraping/core/pipeline';
import { enrichStore } from '../src/lib/enrichment/runner';
import { liveStores } from '../src/lib/scraping/registry';
import { scoreAll } from '../src/lib/pricing/score';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const INTERVAL_HOURS = Number(arg('every') ?? 6);
const MAX_PRODUCTS = Number(arg('max-products') ?? 6000);
const ENRICH_PER_CYCLE = Number(arg('enrich') ?? 200);

const controller = new AbortController();
let stopping = false;

process.on('SIGINT', () => {
  if (stopping) process.exit(1); // deuxième Ctrl+C : sortie immédiate
  stopping = true;
  console.log('\nArrêt demandé — on termine le cycle en cours…');
  controller.abort();
});

const ts = () => new Date().toLocaleTimeString('fr-CA');
const log = (m: string) => console.log(`[${ts()}] ${m}`);
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    controller.signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

async function cycle(n: number) {
  log(`── Cycle ${n} ──`);

  for (const store of liveStores()) {
    if (controller.signal.aborted) return;

    // 1. Relevé de prix
    const res = await crawl({
      storeId: store.id,
      strategy: 'deals',
      maxProducts: MAX_PRODUCTS,
      maxPages: 90,
      signal: controller.signal,
      log: () => {},
    });
    log(
      `${store.name} · crawl ${res.status} — ${res.seen} vus, ${res.created} nouveaux, ` +
        `${res.priceChanges} changements de prix, ${res.requests} requêtes`,
    );

    const retired = retireStaleProducts(store.id);
    if (retired) log(`${store.name} · ${retired} produit(s) retiré(s) du catalogue`);

    if (controller.signal.aborted) return;

    // 2. Enrichissement des informations manquantes
    const enr = await enrichStore({
      storeId: store.id,
      limit: ENRICH_PER_CYCLE,
      signal: controller.signal,
      log: () => {},
    });
    if (enr.attempted > 0) {
      log(
        `${store.name} · enrichissement — ${enr.ok} complets, ${enr.partial} partiels, ` +
          `${enr.failed} échecs, ${enr.requests} requêtes`,
      );
    }
  }

  // 3. Recalcul des scores, une fois toutes les données à jour
  const scored = scoreAll();
  log(`${scored} scores recalculés.`);
}

async function main() {
  migrate();
  seedReferenceData();

  console.log(
    `Ordonnanceur démarré — un cycle toutes les ${INTERVAL_HOURS} h.\n` +
      `Magasins actifs : ${liveStores().map((s) => s.name).join(', ')}\n` +
      `Ctrl+C pour arrêter proprement.\n`,
  );

  let n = 1;
  while (!controller.signal.aborted) {
    try {
      await cycle(n++);
    } catch (err) {
      // Une erreur ne doit jamais tuer la boucle : le disjoncteur du pipeline
      // gère déjà la mise en pause du magasin fautif.
      log(`Erreur de cycle : ${err instanceof Error ? err.message : err}`);
    }

    if (controller.signal.aborted) break;
    log(`Prochain cycle dans ${INTERVAL_HOURS} h.`);
    await sleep(INTERVAL_HOURS * 3600_000);
  }

  console.log('Ordonnanceur arrêté.');
}

main().catch((err) => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
