/**
 * LE GARDE-FOU DE LA BASE.
 *
 *   npx tsx scripts/garde-base.ts empreinte  > empreinte.json
 *   npx tsx scripts/garde-base.ts verifier   < empreinte.json
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Le cycle d'integration continue telecharge la base, travaille dessus, puis
 * la reverse sur la release en ECRASANT la precedente. Tant que tout se passe
 * bien, c'est exactement ce qu'on veut.
 *
 * Mais l'etape de telechargement se terminait par `|| echo "demarrage a vide"`,
 * ce qui avalait TOUTE erreur — reseau, jeton expire, quota depasse. Le cycle
 * repartait alors d'une base neuve, la remplissait de ce qu'il pouvait en
 * quinze minutes, et ecrasait la vraie. Un incident passager suffisait a
 * effacer des semaines d'historique de prix, sans un mot dans le journal.
 *
 * Une empreinte prise avant, verifiee apres, rend cet accident impossible :
 * une base qui a FONDU n'est pas archivee. Perdre un cycle est reparable ;
 * perdre l'historique ne l'est pas.
 */
import { db, DB_PATH } from '../src/lib/db/index';
import { existsSync, statSync } from 'node:fs';

/**
 * Tolerance a la baisse.
 *
 * Le catalogue rétrecit legitimement : les produits disparus du site sont
 * desactives au bout de quatorze jours, et un marchand peut liquider un rayon.
 * Une variation de quelques pour cent est normale. Une chute d'un cinquieme ne
 * l'est pas — a cette echelle, c'est une base qui a ete perdue, pas un
 * catalogue qui a maigri.
 */
const CHUTE_MAX = 0.2;

interface Empreinte {
  produits: number;
  historique: number;
  octets: number;
}

function empreinte(): Empreinte {
  if (!existsSync(DB_PATH)) return { produits: 0, historique: 0, octets: 0 };
  const conn = db();
  const un = (sql: string) => {
    try {
      return (conn.prepare(sql).get() as { n: number }).n;
    } catch {
      return 0; // table absente : base neuve, pas une anomalie
    }
  };
  return {
    produits: un('SELECT COUNT(*) n FROM products'),
    historique: un('SELECT COUNT(*) n FROM price_points'),
    octets: statSync(DB_PATH).size,
  };
}

const action = process.argv[2];

if (action === 'empreinte') {
  console.log(JSON.stringify(empreinte()));
} else if (action === 'verifier') {
  const avant: Empreinte = JSON.parse(process.argv[3] ?? '{}');
  const apres = empreinte();

  const dire = (q: string, a: number, b: number) =>
    `${q} : ${a} -> ${b} (${b >= a ? '+' : ''}${b - a})`;

  console.log(dire('produits  ', avant.produits ?? 0, apres.produits));
  console.log(dire('historique', avant.historique ?? 0, apres.historique));

  // Une base de depart vide est le cas normal du tout premier cycle : il n'y a
  // alors rien a proteger.
  if (!avant.produits) {
    console.log('Base de depart vide — premier cycle, archivage autorise.');
    process.exit(0);
  }

  const chute = 1 - apres.produits / avant.produits;
  if (chute > CHUTE_MAX) {
    console.error(
      `\nARCHIVAGE REFUSE : le catalogue a perdu ${(chute * 100).toFixed(0)} % ` +
        `de ses produits (${avant.produits} -> ${apres.produits}).\n` +
        `Une chute pareille signale une base perdue, pas un catalogue qui maigrit.\n` +
        `La base de la release est CONSERVEE telle quelle.`,
    );
    process.exit(1);
  }

  if (apres.historique < avant.historique) {
    console.error(
      `\nARCHIVAGE REFUSE : l'historique de prix a RECULE ` +
        `(${avant.historique} -> ${apres.historique}).\n` +
        `Il ne peut que croitre : cette base n'est pas la continuation de la precedente.`,
    );
    process.exit(1);
  }

  console.log('Base coherente avec la precedente — archivage autorise.');
} else {
  console.error('Usage : garde-base.ts empreinte | verifier <json>');
  process.exit(2);
}
