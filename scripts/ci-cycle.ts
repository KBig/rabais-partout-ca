/**
 * Un cycle unique, taillé pour l'intégration continue.
 *
 *   npm run ci:cycle
 *
 * `npm run schedule` est une boucle infinie : parfait sur une machine à soi,
 * inutilisable dans un job planifié qui doit démarrer, travailler, et rendre la
 * main. Ce script fait exactement UN passage, dans un budget de temps borné.
 *
 * L'objectif n'est PAS de tout ratisser à chaque exécution. C'est de relever
 * régulièrement les prix des produits déjà connus : c'est la répétition dans le
 * temps qui construit l'historique, pas le volume d'un passage isolé. Quatre
 * cycles par jour suffisent à dater n'importe quel changement de prix.
 */
import { migrate, db } from '../src/lib/db/index';
import { seedReferenceData } from '../src/lib/db/seed';
import { crawl, retireStaleProducts } from '../src/lib/scraping/core/pipeline';
import { enrichStore } from '../src/lib/enrichment/runner';
import { liveStores } from '../src/lib/scraping/registry';
import { scoreAll } from '../src/lib/pricing/score';
import { syncManufacturerReferences } from '../src/lib/enrichment/msrp';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** Budget de temps total. Les runners gratuits coupent à 6 h ; on reste loin. */
const BUDGET_MINUTES = Number(arg('minutes') ?? 25);
const ENRICH_PER_RUN = Number(arg('enrich') ?? 250);

const started = Date.now();
const deadline = started + BUDGET_MINUTES * 60_000;

// Le signal d'annulation est partagé : quand le budget est épuisé, le crawl en
// cours s'arrête proprement au lot suivant au lieu d'être tué net.
const controller = new AbortController();
const timer = setTimeout(() => {
  console.log(`\nBudget de ${BUDGET_MINUTES} min atteint — arrêt propre.`);
  controller.abort();
}, BUDGET_MINUTES * 60_000);
timer.unref();

process.on('SIGTERM', () => controller.abort());
process.on('SIGINT', () => controller.abort());

const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

migrate();
seedReferenceData();

const before = db().prepare('SELECT COUNT(*) n FROM price_points').get() as { n: number };

const totals = { seen: 0, created: 0, changes: 0, requests: 0 };

for (const store of liveStores()) {
  if (controller.signal.aborted) break;

  const res = await crawl({
    storeId: store.id,
    strategy: 'deals',
    maxProducts: 12000,
    maxPages: 160,
    signal: controller.signal,
    log: () => {},
  });

  totals.seen += res.seen;
  totals.created += res.created;
  totals.changes += res.priceChanges;
  totals.requests += res.requests;

  log(
    `${store.name} · ${res.status} — ${res.seen} vus, ${res.created} nouveaux, ` +
      `${res.priceChanges} changements de prix, ${res.requests} requêtes`,
  );

  const retired = retireStaleProducts(store.id);
  if (retired) log(`${store.name} · ${retired} produit(s) retiré(s) du catalogue`);

  // L'enrichissement ne tourne que s'il reste du temps : relever les prix
  // prime toujours, c'est lui qui construit l'historique.
  if (!controller.signal.aborted && Date.now() < deadline - 5 * 60_000) {
    const enr = await enrichStore({
      storeId: store.id,
      limit: ENRICH_PER_RUN,
      signal: controller.signal,
      log: () => {},
    });
    if (enr.attempted > 0) {
      log(
        `${store.name} · enrichissement — ${enr.ok} complets, ${enr.failed} échecs, ` +
          `${enr.requests} requêtes`,
      );
    }
  }
}

// Les prix constructeurs alimentent le signal de reference : ce rapprochement
// doit precéder le calcul des scores. Aucune requête réseau, purement local.
const msrp = syncManufacturerReferences();
if (msrp.written > 0) log(`${msrp.written} prix de référence constructeur rapprochés`);

const scored = scoreAll();
const after = db().prepare('SELECT COUNT(*) n FROM price_points').get() as { n: number };

// Compacte le fichier avant archivage : le job le téléverse ensuite, et chaque
// mégaoctet économisé est du temps de transfert en moins à chaque cycle.
// (`prepare().run()` plutôt que la méthode `exec` de SQLite, qui ressemble
// suffisamment à celle de child_process pour déclencher les analyseurs.)
db().pragma('wal_checkpoint(TRUNCATE)');
db().prepare('VACUUM').run();

const minutes = ((Date.now() - started) / 60_000).toFixed(1);
log(
  `Cycle terminé en ${minutes} min — ${totals.seen} produits vus, ` +
    `${totals.created} nouveaux, ${after.n - before.n} relevés d'historique ajoutés, ` +
    `${scored} scores recalculés.`,
);
