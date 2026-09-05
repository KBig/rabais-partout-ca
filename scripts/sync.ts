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

/**
 * D'OU L'ON TELECHARGE.
 *
 * Le depot est public : sa piece jointe de release s'obtient par un simple
 * lien, sans compte ni outil. La premiere version passait par `gh`, ce qui
 * imposait d'installer et de connecter le client GitHub sur toute machine
 * voulant reprendre le projet. Node et Git suffisent desormais.
 *
 * `gh` reste en second recours : il sait lire un depot prive, et sert donc si
 * la visibilite change un jour.
 */
const DEPOT = 'KBig/rabais-partout-ca';
const LIEN = `https://github.com/${DEPOT}/releases/download/db/itemfinder.db.zst`;

async function telecharger(url: string, cible: string): Promise<void> {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

  const annonce = Number(r.headers.get('content-length') ?? 0);
  if (annonce) console.log(`  archive annoncee : ${mo(annonce)}`);

  const { Writable } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  const { createWriteStream } = await import('node:fs');

  let recu = 0;
  const sortie = createWriteStream(cible);
  await pipeline(
    r.body as unknown as NodeJS.ReadableStream,
    new Writable({
      write(morceau: Buffer, _enc, suite) {
        recu += morceau.length;
        sortie.write(morceau, () => suite());
      },
      final(suite) {
        sortie.end(() => suite());
      },
    }),
  );

  // Un telechargement coupe rend un fichier valide en apparence. Le comparer a
  // la taille annoncee coute une soustraction et evite de remplacer une base
  // qui marche par une archive tronquee.
  if (annonce && recu !== annonce) {
    rmSync(cible, { force: true });
    throw new Error(`archive incomplete : ${recu} octets sur ${annonce}`);
  }
}

mkdirSync(dossier, { recursive: true });

// Une base neuve laissee par un essai interrompu evite de tout retelecharger.
const dejaLa = existsSync(neuve) && statSync(neuve).size > 1_000_000;
if (dejaLa) console.log('Base deja telechargee lors d un essai precedent — reprise.');

console.log(dejaLa ? '' : 'Telechargement de la base publiee…');
try {
  if (!dejaLa) await telecharger(LIEN, compresse);
} catch (e) {
  console.log(`  lien public indisponible (${(e as Error).message}) — essai par gh`);
  sh('gh', [
    'release', 'download', 'db', '--repo', DEPOT,
    '--pattern', 'itemfinder.db.zst', '--dir', dossier, '--clobber',
  ]);
}
if (!dejaLa) console.log(`  archive : ${mo(statSync(compresse).size)}`);

// L'outil `zstd` n'est pas installe d'office sous Windows : la decompression
// passe par une bibliotheque JavaScript pure, sans rien a installer a cote.
//
// EN FLUX, jamais d'un bloc : la base decompressee approche le gigaoctet et ne
// tiendrait pas dans un seul tampon.
if (!dejaLa) {
  await decompresser(compresse, neuve);
  rmSync(compresse, { force: true });
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

/**
 * L'ECHANGE DES FICHIERS.
 *
 * Windows refuse de renommer un fichier qu'un autre programme tient ouvert.
 * Le site en cours d'execution garde une connexion a la base : la commande
 * echouait alors sur une pile d'erreurs « EBUSY » incomprehensible, la base
 * neuve deja telechargee et abandonnee sur le disque.
 *
 * Le cas est banal — on oublie que le site tourne — et il merite une phrase,
 * pas une trace d'exception.
 */
try {
  if (existsSync(DB_PATH)) {
    rmSync(precedente, { force: true });
    renameSync(DB_PATH, precedente);
  }
  renameSync(neuve, DB_PATH);
} catch (e) {
  const err = e as NodeJS.ErrnoException;
  if (err.code === 'EBUSY' || err.code === 'EPERM') {
    console.error(
      `
La base actuelle est ouverte par un autre programme — le site, sans doute.
` +
        `Arretez-le, puis relancez « npm run sync ».
` +
        `La base telechargee est conservee sous ${neuve} : rien n'est a retelecharger.`,
    );
    process.exit(1);
  }
  throw e;
}
// Les fichiers WAL de l'ancienne base ne decrivent plus celle-ci.
for (const suffixe of ['-wal', '-shm']) rmSync(`${DB_PATH}${suffixe}`, { force: true });

console.log(`\nBase a jour : ${produits} produits, ${mo(statSync(DB_PATH).size)}.`);
console.log(`L'ancienne est conservee sous ${precedente}.`);
