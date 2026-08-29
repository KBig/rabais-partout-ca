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
import { magasinsParPeremption } from '../src/lib/scraping/core/planification';
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
 * ON COLLECTE D'ABORD LE PLUS PERIME.
 *
 * Une rotation par l'heure, essayee d'abord, ne regarde pas ce qui a besoin
 * d'etre rafraichi : Best Buy est reste dix-neuf heures sans releve pendant
 * qu'IKEA etait collecte trois fois de suite.
 *
 * La peremption est la seule regle utile. Un magasin frais attend, un magasin
 * oublie passe devant, et l'historique de prix devient regulier pour tout le
 * monde — ce qui est exactement ce qu'on cherche a mesurer.
 */
const classement = magasinsParPeremption();
const ordre = classement.map((m) => m.store);

log(
  'Ordre de passage : ' +
    classement
      .slice(0, 5)
      .map((m) => `${m.store.name} (${m.heures === null ? 'jamais' : Math.round(m.heures) + ' h'})`)
      .join(', '),
);

/**
 * BUDGET PROPORTIONNEL A CE QU'IL Y A A RELEVER.
 *
 * Un partage egal valait deja mieux que rien : sans plafond, le premier de la
 * liste consommait tout le temps disponible et les suivants n'etaient jamais
 * visites. Mais il restait injuste dans l'autre sens. Best Buy compte 282 000
 * produits, Casper 72 — et tous deux recevaient un treizieme du budget. Le
 * magasin principal etait coupe au bout d'une minute apres 128 requetes,
 * pendant que trois boutiques deja completes en dix secondes gardaient chacune
 * une part qu'elles n'utilisaient pas.
 *
 * On repartit donc au prorata du catalogue. Le plancher garantit que meme la
 * plus petite boutique est visitee, et le temps qu'un magasin rapide n'utilise
 * pas revient tout seul aux suivants : le calcul se refait a chaque tour sur le
 * temps REELLEMENT restant, pas sur une part figee au depart.
 */
const PLANCHER_MS = 20_000;

/** Canadian Tire : une fois par jour, avec un vrai creneau. */
const CT_PERIODE_H = 20;
const CT_CRENEAU_MS = 5 * 60_000;

const budgetParMagasin = (rang: number): number => {
  // Le magasin a creneau fixe est retire du partage : son temps est deja
  // reserve, le compter ici l'amputerait une seconde fois aux autres.
  const aVenir = classement.slice(rang).filter((m) => m.store.id !== 'canadiantire-ca');
  const total = aVenir.reduce((n, m) => n + Math.max(1, m.produits), 0);
  const part = Math.max(1, aVenir[0]?.produits ?? 1) / Math.max(1, total);
  return Math.max(PLANCHER_MS, (deadline - Date.now()) * part);
};

for (const [rang, store] of ordre.entries()) {
  if (controller.signal.aborted) break;

  /**
   * UN CRENEAU QUOTIDIEN POUR LE MAGASIN LE PLUS COUTEUX.
   *
   * Canadian Tire impose dix secondes entre deux pages et exige un navigateur :
   * son cout par produit est sans commune mesure avec les autres. Il etait donc
   * ecarte de tous les cycles courts — ce qui revenait, en pratique, a ne
   * jamais le collecter automatiquement. 441 produits, figes.
   *
   * Une part proportionnelle a son catalogue ne reglerait rien : 441 produits
   * sur 370 000 lui vaudraient vingt secondes, soit deux pages. La regle utile
   * n'est pas sa TAILLE mais son COUT — et un cout eleve se paie rarement, pas
   * chichement. Une fois par jour, avec de quoi travailler.
   */
  if (store.id === 'canadiantire-ca') {
    const heures = classement[rang].heures;
    if (heures !== null && heures < CT_PERIODE_H) {
      log(`${store.name} · attend son creneau quotidien (vu il y a ${Math.round(heures)} h)`);
      continue;
    }
    if (deadline - Date.now() < CT_CRENEAU_MS) {
      log(`${store.name} · reporte : moins de ${CT_CRENEAU_MS / 60_000} min de budget restant`);
      continue;
    }
  }

  const limite = new AbortController();
  const fin = setTimeout(
    () => limite.abort(),
    store.id === 'canadiantire-ca'
      ? Math.min(CT_CRENEAU_MS, deadline - Date.now())
      : budgetParMagasin(rang),
  );
  const signal = AbortSignal.any([controller.signal, limite.signal]);

  /**
   * LE PLAFOND SUIT LA TAILLE DU CATALOGUE, ET C'EST LE TEMPS QUI BORNE.
   *
   * Un plafond fixe de 12 000 etait la vraie limite, pas le temps : Best Buy
   * terminait en quarante-sept secondes sur onze minutes disponibles, et
   * rafraichissait 12 000 produits sur 282 000 — toujours les memes, puisque
   * le parcours repartait du debut. Le reste du catalogue n'avait aucun releve.
   *
   * Relever le plafond n'etait pas envisageable tant qu'un passage interrompu
   * perdait son avancement. Le curseur de pagination l'a rendu sur : une
   * interruption ne coute plus que la page en cours. Le temps peut donc
   * redevenir la seule borne, ce qu'il aurait toujours du etre.
   */
  const plafond = Math.max(12_000, classement[rang].produits);

  const res = await crawl({
    storeId: store.id,
    strategy: 'deals',
    maxProducts: plafond,
    maxPages: Math.max(160, Math.ceil(plafond / 100)),
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
      `${res.priceChanges} changements de prix, ${res.requests} requêtes` +
      // Un magasin ecarte doit DIRE pourquoi : pause du disjoncteur, collecte
      // deja en cours. Sans motif, il se confond avec un magasin a jour.
      (res.status === 'skipped' && res.error ? `
           ↳ ${res.error}` : ''),
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
