/**
 * Construit une base ALLÉGÉE, destinée à être déployée en ligne.
 *
 *   npm run export:public
 *
 * ----------------------------------------------------------------------------
 * POURQUOI
 * ----------------------------------------------------------------------------
 *
 * La base de travail pèse près de 300 Mo : 202 000 produits, leur historique,
 * leurs index de recherche. C'est parfait sur une machine, et impossible à
 * héberger gratuitement — les offres gratuites plafonnent généralement autour
 * de 250 Mo, et Git refuse les fichiers de plus de 100 Mo.
 *
 * Or un site de bonnes affaires n'a aucun besoin des 202 000 produits :
 * seulement 7 000 dépassent un score de 30. Le reste, ce sont des articles au
 * prix normal, que personne ne vient chercher ici. Ils restent utiles LOCALEMENT
 * — ils forment les groupes de comparaison qui donnent leur sens aux scores —
 * mais ils n'ont pas à voyager.
 *
 * Ce script produit donc une base publique contenant les produits qui valent la
 * peine d'être montrés, leur historique, et l'index de recherche. La base
 * complète reste sur la machine de collecte, où elle continue d'alimenter les
 * comparaisons.
 */
import { existsSync, mkdirSync, rmSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { db, DB_PATH, migrate } from '../src/lib/db/index';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/**
 * Score minimal pour figurer dans la base publique.
 *
 * 20 conserve environ 40 000 produits — assez pour que chaque catégorie ait du
 * contenu et que la recherche trouve autre chose que les vedettes, tout en
 * divisant la taille par cinq.
 */
const MIN_SCORE = Number(arg('min-score') ?? 20);
const OUT = arg('out') ?? join(dirname(DB_PATH), 'itemfinder-public.db');

migrate();
const source = db();

if (existsSync(OUT)) rmSync(OUT, { force: true });
mkdirSync(dirname(OUT), { recursive: true });

console.log(`Source : ${DB_PATH}`);
console.log(`Cible  : ${OUT}`);
console.log(`Seuil  : score > ${MIN_SCORE}\n`);

// Le schéma est reconstruit en REJOUANT LES MIGRATIONS, pas en copiant les
// définitions de la base source.
//
// Une première version lisait `sqlite_master` et rejouait chaque instruction :
// l'ordre des dépendances n'était alors pas garanti, la table virtuelle de
// recherche échouait à se créer, et toutes les copies suivantes tombaient sur
// des violations de clé étrangère. Les migrations, elles, sont écrites dans
// l'ordre par construction.
const out = new Database(OUT);
out.pragma('journal_mode = WAL');

const migrationsDir = join(dirname(DB_PATH), '..', 'src', 'lib', 'db', 'migrations');
for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8');
  out.exec(sql);
}
// `backfill_attempts` ne sert qu'à la collecte. `crawl_runs`, en revanche,
// porte la date du dernier passage — que le site affiche. La supprimer faisait
// planter la page d'accueil sur « no such table: crawl_runs ». Elle pèse
// quelques kilo-octets : on la garde, tronquée aux passages récents.
out.exec('DROP TABLE IF EXISTS backfill_attempts;');
out.close();

// Le transfert se fait depuis la base source, via ATTACH : SQLite copie alors
// les lignes sans passer par JavaScript, ce qui est bien plus rapide.
source.prepare(`ATTACH DATABASE ? AS pub`).run(OUT);

const copie: Array<[string, string]> = [
  ['stores', 'SELECT * FROM stores'],
  ['categories', 'SELECT * FROM categories'],
  [
    'products',
    `SELECT p.* FROM products p JOIN deal_scores s ON s.product_id = p.id
      WHERE s.is_active = 1 AND s.score > ${MIN_SCORE}`,
  ],
  [
    'deal_scores',
    `SELECT * FROM deal_scores WHERE is_active = 1 AND score > ${MIN_SCORE}`,
  ],
  [
    'price_points',
    `SELECT pp.* FROM price_points pp
       JOIN deal_scores s ON s.product_id = pp.product_id
      WHERE s.is_active = 1 AND s.score > ${MIN_SCORE}`,
  ],
  [
    'product_enrichment',
    `SELECT e.* FROM product_enrichment e
       JOIN deal_scores s ON s.product_id = e.product_id
      WHERE s.is_active = 1 AND s.score > ${MIN_SCORE}`,
  ],
  // Tronquée aux passages récents : le site n'affiche que le dernier.
  ['crawl_runs', 'SELECT * FROM crawl_runs ORDER BY started_at DESC LIMIT 50'],
  [
    'price_references',
    `SELECT r.* FROM price_references r
       JOIN deal_scores s ON s.product_id = r.product_id
      WHERE s.is_active = 1 AND s.score > ${MIN_SCORE}`,
  ],
];

for (const [table, select] of copie) {
  try {
    const info = source.prepare(`INSERT INTO pub.${table} ${select}`).run();
    console.log(`  ${String(info.changes).padStart(7)} lignes -> ${table}`);
  } catch (err) {
    console.log(`  (${table} ignorée : ${err instanceof Error ? err.message : err})`);
  }
}

// L'index de recherche se reconstruit à partir des lignes copiées.
try {
  source.prepare("INSERT INTO pub.products_fts(products_fts) VALUES('rebuild')").run();
  console.log('  index de recherche reconstruit');
} catch (err) {
  console.log(`  (index FTS : ${err instanceof Error ? err.message : err})`);
}

source.prepare('DETACH DATABASE pub').run();

// Compactage final : sans lui le fichier conserve l'espace des pages libérées.
const final = new Database(OUT);
final.pragma('wal_checkpoint(TRUNCATE)');
final.prepare('VACUUM').run();
final.close();

const mo = (p: string) => (statSync(p).size / 1048576).toFixed(1);
console.log(`\nBase complète  : ${mo(DB_PATH)} Mo`);
console.log(`Base publique  : ${mo(OUT)} Mo`);
console.log(
  '\nLa base complète reste sur la machine de collecte : ses 200 000 produits\n' +
    'continuent d’alimenter les groupes de comparaison qui donnent leur sens aux\n' +
    'scores. Seuls les produits qui valent la peine d’être montrés voyagent.',
);
