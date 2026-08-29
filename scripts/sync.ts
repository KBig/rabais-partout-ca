/**
 * RAPATRIE LA BASE A JOUR.
 *
 *   npm run sync
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * La collecte tourne sur GitHub, pas ici. C'est la base de la release `db` qui
 * fait foi : elle est relevee quatre fois par jour, sans que cette machine ait
 * besoin d'etre allumee.
 *
 * Cette commande la telecharge pour que le site affiche des prix a jour. Elle
 * ne collecte RIEN : lancer une collecte locale ferait diverger les deux bases,
 * et la derniere a etre televersee ecraserait le travail de l'autre.
 *
 * La base locale precedente est conservee sous `.precedente` jusqu'a ce que la
 * nouvelle soit verifiee. Un telechargement interrompu ne doit pas laisser un
 * fichier tronque a la place d'une base qui marchait.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, renameSync, rmSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import Database from 'better-sqlite3';
import { DB_PATH } from '../src/lib/db/index';

const dossier = dirname(DB_PATH);
const compresse = join(dossier, 'itemfinder.db.zst');
const neuve = join(dossier, 'itemfinder.db.neuve');
const precedente = `${DB_PATH}.precedente`;

const sh = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();

const mo = (o: number) => `${(o / 1e6).toFixed(0)} Mo`;

async function decompresser(source: string, cible: string): Promise<void> {
  const { createReadStream, createWriteStream } = await import('node:fs');
  const { Decompress } = await import('fzstd');
  const sortie = createWriteStream(cible);

  // Le decompresseur rend PLUSIEURS morceaux par bloc lu ; on les ecrit en
  // respectant la contre-pression, sinon la memoire enfle jusqu'a la taille
  // totale du fichier — ce qu'on cherche justement a eviter.
  //
  // UNE SEULE attente partagee, pas une par ecriture refusee. Elles se
  // resoudraient toutes sur le meme evenement « drain », et en poser une
  // dizaine par bloc ferait grimper le nombre d'ecouteurs jusqu'a
  // l'avertissement de fuite — pour attendre exactement la meme chose.
  let saturation: Promise<void> | null = null;
  const flux = new Decompress((morceau) => {
    if (!sortie.write(morceau) && !saturation) {
      saturation = new Promise<void>((r) =>
        sortie.once('drain', () => {
          saturation = null;
          r();
        }),
      );
    }
  });

  for await (const bloc of createReadStream(source, { highWaterMark: 8 << 20 })) {
    flux.push(bloc as Uint8Array);
    if (saturation) await saturation;
  }
  flux.push(new Uint8Array(0), true);
  if (saturation) await saturation;

  await new Promise<void>((ok, ko) => {
    sortie.once('error', ko);
    sortie.end(() => ok());
  });
}

mkdirSync(dossier, { recursive: true });

console.log('Telechargement de la base publiee…');
const publiees = sh('gh', ['release', 'view', 'db', '--json', 'assets', '--jq', '.assets[].name'])
  .split('\n')
  .map((s) => s.trim());

if (publiees.includes('itemfinder.db.zst')) {
  sh('gh', ['release', 'download', 'db', '--pattern', 'itemfinder.db.zst', '--dir', dossier, '--clobber']);
  console.log(`  archive : ${mo(statSync(compresse).size)}`);
  // L'outil `zstd` n'est pas installe d'office sous Windows : la decompression
  // passe par une bibliotheque JavaScript pure, sans rien a installer a cote.
  //
  // EN FLUX, jamais d'un bloc : la base decompressee approche le gigaoctet et
  // ne tiendrait pas dans un seul tampon.
  await decompresser(compresse, neuve);
  rmSync(compresse, { force: true });
} else if (publiees.includes('itemfinder.db')) {
  // Ancien format, non compresse. Le telechargement va dans un dossier a part :
  // vise sur `data/`, il ecraserait la base locale AVANT toute verification,
  // ce qui est exactement ce que cette commande s'interdit.
  const bac = join(dossier, '.telechargement');
  mkdirSync(bac, { recursive: true });
  sh('gh', ['release', 'download', 'db', '--pattern', 'itemfinder.db', '--dir', bac, '--clobber']);
  renameSync(join(bac, 'itemfinder.db'), neuve);
  rmSync(bac, { recursive: true, force: true });
} else {
  console.error('Aucune base publiee sur la release `db`.');
  process.exit(1);
}

// VERIFIER AVANT DE REMPLACER.
//
// Un telechargement interrompu produit un fichier valide en apparence. On
// l'ouvre et on compte les produits : une base illisible ou vide ne doit pas
// prendre la place d'une base qui marchait.
let produits = 0;
try {
  const test = new Database(neuve, { readonly: true });
  produits = (test.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n;
  test.close();
} catch (e) {
  console.error(`Base telechargee illisible : ${(e as Error).message}`);
  rmSync(neuve, { force: true });
  process.exit(1);
}

if (produits === 0) {
  console.error('Base telechargee vide — remplacement annule.');
  rmSync(neuve, { force: true });
  process.exit(1);
}

if (existsSync(DB_PATH)) {
  rmSync(precedente, { force: true });
  renameSync(DB_PATH, precedente);
}
renameSync(neuve, DB_PATH);
// Les fichiers WAL de l'ancienne base ne decrivent plus celle-ci.
for (const suffixe of ['-wal', '-shm']) rmSync(`${DB_PATH}${suffixe}`, { force: true });

console.log(`\nBase a jour : ${produits} produits, ${mo(statSync(DB_PATH).size)}.`);
console.log(`L'ancienne est conservee sous ${precedente}.`);
