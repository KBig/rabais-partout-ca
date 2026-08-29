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
import { reconcile, electVariantLeads } from '../src/lib/scraping/core/coherence';
import { buildSpecDistribution } from '../src/lib/quality/components';
import { closeRenderer } from '../src/lib/scraping/core/renderer';

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

/**
 * L'ORDRE DE PASSAGE TOURNE D'UN CYCLE A L'AUTRE.
 *
 * Avec un seul magasin, l'ordre etait sans objet. Avec dix et un budget de
 * quinze minutes, commencer toujours par le meme voudrait dire que le dernier
 * n'est jamais atteint : ses prix ne bougeraient jamais, et son historique
 * resterait vide.
 *
 * On decale donc le point de depart a chaque execution, en s'appuyant sur
 * l'heure — deterministe, sans etat a conserver, et reparti sur la journee.
 */
const magasins = liveStores();
const depart = Math.floor(Date.now() / 3_600_000) % Math.max(1, magasins.length);
const ordre = [...magasins.slice(depart), ...magasins.slice(0, depart)];

/**
 * Budget par magasin.
 *
 * Sans plafond, le premier de la liste consommait tout le temps disponible et
 * les suivants n'etaient jamais visites. Chacun recoit sa part, et le temps
 * rendu par un magasin rapide profite aux suivants.
 */
const budgetParMagasin = (restants: number) =>
  Math.max(60_000, (deadline - Date.now()) / Math.max(1, restants));

for (const [rang, store] of ordre.entries()) {
  if (controller.signal.aborted) break;

  // Un magasin qui exige un navigateur ne tourne pas dans un cycle court :
  // dix secondes par page imposees par le marchand n'y tiennent pas. Il se
  // collecte a part, sur une machine dediee.
  if (store.id === 'canadiantire-ca') {
    log(`${store.name} · ignore en cycle court (Crawl-delay de 10 s impose)`);
    continue;
  }

  const limite = new AbortController();
  const fin = setTimeout(() => limite.abort(), budgetParMagasin(ordre.length - rang));
  const signal = AbortSignal.any([controller.signal, limite.signal]);

  const res = await crawl({
    storeId: store.id,
    strategy: 'deals',
    maxProducts: 12000,
    maxPages: 160,
    signal,
    log: () => {},
  });
  clearTimeout(fin);

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

// La mise en coherence precede le calcul : elle corrige des faits dont le
// score depend — image heritee d'une unite boite ouverte, note sans avis.
reconcile((m) => log(m.trim()));

const scored = scoreAll();

// Le representant d'un groupe de variantes est celui qui ressort le mieux :
// il faut donc les scores pour le designer.
const masquees = electVariantLeads();
if (masquees > 0) log(`${masquees} variante(s) masquee(s) du classement`);

// Les distributions de caracteristiques suivent le marche : elles doivent etre
// recalculees quand le catalogue bouge, sinon « 16 Go » serait juge d'apres un
// marche d'il y a six mois.
const specs = buildSpecDistribution(() => {});
log(`${specs.caracteristiques} caracteristiques indexees, ${specs.retenues} distributions`);

await closeRenderer();
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
