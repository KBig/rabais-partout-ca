/**
 * AUDIT DE VRAISEMBLANCE
 *
 *   npm run audit
 *
 * ----------------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE
 * ----------------------------------------------------------------------------
 *
 * Le typage, les tests et le build répondent tous à la même question : « est-ce
 * que ça plante ? ». Or aucun des vrais défauts trouvés sur ce projet ne
 * plantait :
 *
 *   - « 2 000 » sur presque toutes les catégories (un plafond d'API pris pour
 *     un inventaire)
 *   - un PC noté 58/100 sur un « prix régulier » de 2 999 $ purement fictif
 *   - 5 600 articles boîte ouverte que AUCUNE page du site n'affichait
 *   - une regex contenant un caractère de contrôle invisible, qui ne matchait
 *     donc jamais rien
 *
 * Tout cela passait au vert. Et les tests unitaires ne pouvaient pas aider :
 * ils s'appuient sur des données inventées, donc ils ne confirment que ce à
 * quoi on avait déjà pensé. Ils sont incapables de surprendre leur auteur.
 *
 * Ce script pose une question différente : « ce résultat est-il VRAISEMBLABLE ? »
 * Il interroge les données réelles à la recherche de ce qu'un humain repère
 * d'un coup d'œil et qu'aucun test ne voit.
 *
 * Il ne prétend pas remplacer un regard humain. Il attrape la classe de défauts
 * qui, sinon, n'est découverte que par hasard.
 */
import { db, migrate } from '../src/lib/db/index';
import { topDeals } from '../src/lib/db/queries';

migrate();
const conn = db();

type Gravite = 'grave' | 'suspect' | 'info';

interface Constat {
  gravite: Gravite;
  titre: string;
  detail: string;
  exemples?: string[];
}

const constats: Constat[] = [];
const ajouter = (c: Constat) => constats.push(c);

const q = <T = any>(sql: string, ...p: unknown[]): T => conn.prepare(sql).get(...p) as T;
const qa = <T = any>(sql: string, ...p: unknown[]): T[] => conn.prepare(sql).all(...p) as T[];

const money = (n: number | null) => (n === null ? '—' : `${n.toFixed(2)} $`);

// ---------------------------------------------------------------------------
// 1. UNIFORMITÉ SUSPECTE
//
// Des compteurs identiques sur des rayons de tailles réelles très différentes
// ne sont jamais une coïncidence : c'est la signature d'un plafond technique
// pris pour un inventaire. C'est exactement ce qui produisait « 2 000 partout ».
// ---------------------------------------------------------------------------
{
  const counts = qa<{ category_slug: string; n: number }>(
    `SELECT category_slug, COUNT(*) n FROM deal_scores
      WHERE is_active = 1 AND category_slug IS NOT NULL
      GROUP BY category_slug HAVING n > 50`,
  );
  const parValeur = new Map<number, string[]>();
  for (const c of counts) {
    parValeur.set(c.n, [...(parValeur.get(c.n) ?? []), c.category_slug]);
  }
  for (const [valeur, cats] of parValeur) {
    if (cats.length >= 3) {
      ajouter({
        gravite: 'grave',
        titre: `${cats.length} catégories comptent exactement ${valeur} produits`,
        detail:
          'Des rayons de tailles réelles différentes ne peuvent pas contenir le même nombre ' +
          'exact de produits. Signature typique d’un plafond de pagination du marchand pris ' +
          'pour un inventaire complet.',
        exemples: cats.slice(0, 6),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 2. CONTENU INATTEIGNABLE
//
// Un produit que la configuration du site ne peut JAMAIS afficher est du
// travail de collecte gaspillé, et une bonne affaire perdue pour l'utilisateur.
// C'est ce qui rendait 5 600 articles boîte ouverte invisibles.
// ---------------------------------------------------------------------------
{
  const parEtat = qa<{ condition: string; n: number; max: number }>(
    `SELECT condition, COUNT(*) n, ROUND(MAX(score), 1) max
       FROM deal_scores WHERE is_active = 1 GROUP BY condition`,
  );
  for (const e of parEtat) {
    if (e.condition === 'new') continue;
    // On teste toutes les vues réellement proposées par le site — dont la
    // section dédiée aux articles d'occasion — et non le seul listing par
    // défaut : sinon on signale comme invisible ce qui a sa propre place.
    const visibles =
      topDeals({ limit: 60, condition: 'all' }).filter((d) => d.condition === e.condition)
        .length +
      topDeals({ limit: 60, condition: 'used' }).filter((d) => d.condition === e.condition)
        .length;
    if (visibles === 0 && e.n > 100) {
      ajouter({
        gravite: 'grave',
        titre: `${e.n} produits « ${e.condition} » n’apparaissent sur aucune page`,
        detail:
          `Leur meilleur score atteint ${e.max}, mais aucun ne remonte dans les listings par ` +
          'défaut. Ils sont collectés, notés, stockés — et invisibles.',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 3. GROUPES DE PAIRS INCOMPARABLES
//
// Un groupe qui s'étale sur un ordre de grandeur ne compare pas des produits
// substituables, et toute conclusion « X % sous la médiane » y est fausse.
// ---------------------------------------------------------------------------
{
  const groupes = qa<{ peer_key: string; n: number; lo: number; hi: number; med: number }>(
    `SELECT peer_key, COUNT(*) n, MIN(price) lo, MAX(price) hi,
            ROUND(AVG(peer_median), 2) med
       FROM deal_scores
      WHERE is_active = 1 AND peer_key IS NOT NULL AND price > 0
      GROUP BY peer_key HAVING n >= 20
      ORDER BY (MAX(price) / NULLIF(MIN(price), 0)) DESC LIMIT 5`,
  );
  const pires = groupes.filter((g) => g.lo > 0 && g.hi / g.lo > 40);
  if (pires.length) {
    ajouter({
      gravite: 'suspect',
      titre: `${pires.length} groupe(s) de pairs s’étalent sur plus d’un facteur 40`,
      detail:
        'Comparer un produit à ce groupe revient à comparer des objets non substituables. ' +
        'Il manque probablement un attribut déterminant le prix dans la clé de regroupement.',
      exemples: pires.map(
        (g) => `${g.peer_key} — ${g.n} produits de ${money(g.lo)} à ${money(g.hi)}`,
      ),
    });
  }
}

// ---------------------------------------------------------------------------
// 4. PRIX RÉGULIERS INVRAISEMBLABLES
// ---------------------------------------------------------------------------
{
  const n = q<{ n: number }>(
    `SELECT COUNT(*) n FROM products
      WHERE is_active = 1 AND list_price IS NOT NULL
        AND current_price > 0 AND list_price > current_price * 4`,
  ).n;
  if (n > 0) {
    const ex = qa<{ title: string; cp: number; lp: number }>(
      `SELECT title, current_price cp, list_price lp FROM products
        WHERE is_active = 1 AND list_price > current_price * 4
        ORDER BY list_price / current_price DESC LIMIT 3`,
    );
    ajouter({
      gravite: n > 500 ? 'grave' : 'suspect',
      titre: `${n} produits affichent un « régulier » plus de 4× supérieur au prix payé`,
      detail:
        'Au-delà de ce rapport, ce n’est plus une liquidation : c’est une erreur de saisie ' +
        'ou un prix de référence fabriqué.',
      exemples: ex.map((e) => `${money(e.cp)} vs ${money(e.lp)} — ${e.title.slice(0, 56)}`),
    });
  }
}

// ---------------------------------------------------------------------------
// 5. CHAMPS DÉGÉNÉRÉS
//
// Une colonne entièrement vide, ou entièrement identique, trahit presque
// toujours une extraction cassée — le genre de panne parfaitement silencieuse.
// ---------------------------------------------------------------------------
{
  const champs: Array<[string, string, string]> = [
    ['products', 'brand', 'marque'],
    ['products', 'model', 'modèle'],
    ['products', 'description', 'description'],
    ['products', 'rating', 'note'],
    ['products', 'image_url', 'image'],
    ['deal_scores', 'peer_key', 'groupe de pairs'],
  ];
  for (const [table, col, label] of champs) {
    const total = q<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`).n;
    if (total === 0) continue;
    const remplis = q<{ n: number }>(
      `SELECT COUNT(*) n FROM ${table} WHERE ${col} IS NOT NULL`,
    ).n;
    const part = remplis / total;
    if (part === 0) {
      ajouter({
        gravite: 'grave',
        titre: `Le champ « ${label} » est vide pour TOUS les enregistrements`,
        detail: `${table}.${col} n’est jamais renseigné. Extraction cassée, ou jamais branchée.`,
      });
    } else if (part < 0.25) {
      ajouter({
        gravite: 'info',
        titre: `« ${label} » renseigné pour seulement ${(part * 100).toFixed(0)} % des produits`,
        detail: `${remplis} sur ${total}. Normal si la collecte est en cours, anormal sinon.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 6. SCORES INCOHÉRENTS AVEC LEURS RAISONS
//
// Un score élevé sans justification affichable est soit un bug de calcul, soit
// une raison manquante — dans les deux cas l'utilisateur ne peut pas juger.
// ---------------------------------------------------------------------------
{
  const muets = qa<{ id: number; score: number; title: string }>(
    `SELECT s.product_id id, s.score, p.title
       FROM deal_scores s JOIN products p ON p.id = s.product_id
      WHERE s.is_active = 1 AND s.score > 45
        AND (s.reasons IS NULL OR s.reasons = '[]')
      LIMIT 3`,
  );
  if (muets.length) {
    ajouter({
      gravite: 'grave',
      titre: `Des produits bien notés n’affichent AUCUNE justification`,
      detail:
        'Un score sans raison est invérifiable par l’utilisateur, et signale généralement une ' +
        'branche de calcul qui n’écrit pas sa motivation.',
      exemples: muets.map((m) => `${m.score.toFixed(1)} — ${m.title.slice(0, 60)}`),
    });
  }
}

// ---------------------------------------------------------------------------
// 7. COUVERTURE DE LA COMPARAISON
// ---------------------------------------------------------------------------
{
  const total = q<{ n: number }>('SELECT COUNT(*) n FROM deal_scores WHERE is_active = 1').n;
  const sansPairs = q<{ n: number }>(
    'SELECT COUNT(*) n FROM deal_scores WHERE is_active = 1 AND peer_size IS NULL',
  ).n;
  if (total > 0 && sansPairs / total > 0.2) {
    ajouter({
      gravite: 'suspect',
      titre: `${((sansPairs / total) * 100).toFixed(0)} % des produits n’ont aucun groupe de comparaison`,
      detail:
        'Sans pairs, le score ne repose plus que sur le prix barré du marchand — le signal le ' +
        'moins fiable. Souvent dû à un type de produit trop rare, ou à un titre atypique.',
    });
  }
}

// ---------------------------------------------------------------------------
// 8. FRAÎCHEUR DE L'HISTORIQUE
// ---------------------------------------------------------------------------
{
  const dernier = q<{ t: string | null }>(
    "SELECT MAX(finished_at) t FROM crawl_runs WHERE status IN ('ok','partial')",
  ).t;
  const heures = dernier ? (Date.now() - Date.parse(dernier)) / 3_600_000 : Infinity;
  if (heures > 24) {
    ajouter({
      gravite: heures > 72 ? 'grave' : 'suspect',
      titre: `Aucune collecte réussie depuis ${Number.isFinite(heures) ? Math.round(heures) + ' h' : 'toujours'}`,
      detail:
        'L’historique de prix ne progresse que si la collecte tourne. Sans elle, les scores ' +
        'vieillissent et la confiance devient trompeuse.',
    });
  }

  const jours = q<{ d: number | null }>(
    'SELECT MAX(days_of_history) d FROM deal_scores WHERE is_active = 1',
  ).d;
  if ((jours ?? 0) < 7) {
    ajouter({
      gravite: 'info',
      titre: `L’historique le plus long atteint ${(jours ?? 0).toFixed(1)} jour(s)`,
      detail:
        'Le signal historique reste faible tant qu’il n’a pas quelques semaines. Les scores ' +
        'reposent surtout sur la comparaison entre produits.',
    });
  }
}

// ---------------------------------------------------------------------------
// 9. PAGES VIDES
// ---------------------------------------------------------------------------
{
  const vides = qa<{ slug: string; name: string }>(
    `SELECT c.slug, c.name FROM categories c
      WHERE NOT EXISTS (
        SELECT 1 FROM deal_scores s
         WHERE s.is_active = 1
           AND (s.category_slug = c.slug
                OR s.category_slug IN (SELECT slug FROM categories WHERE parent_slug = c.slug))
      )
        AND c.parent_slug IS NULL`,
  );
  if (vides.length > 3) {
    ajouter({
      gravite: 'info',
      titre: `${vides.length} catégories racines sont vides`,
      detail: 'Elles s’affichent comme « à venir ». Normal tant que la source n’est pas branchée.',
      exemples: vides.slice(0, 5).map((v) => v.name),
    });
  }
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------
const ordre: Record<Gravite, number> = { grave: 0, suspect: 1, info: 2 };
constats.sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);

const marque: Record<Gravite, string> = {
  grave: '[GRAVE]  ',
  suspect: '[SUSPECT]',
  info: '[INFO]   ',
};

console.log('\n════════ AUDIT DE VRAISEMBLANCE ════════\n');

if (constats.length === 0) {
  console.log('Aucune invraisemblance détectée.\n');
} else {
  for (const c of constats) {
    console.log(`${marque[c.gravite]} ${c.titre}`);
    console.log(`           ${c.detail}`);
    for (const e of c.exemples ?? []) console.log(`             · ${e}`);
    console.log();
  }
}

const graves = constats.filter((c) => c.gravite === 'grave').length;
const suspects = constats.filter((c) => c.gravite === 'suspect').length;
console.log(`${graves} grave(s), ${suspects} suspect(s), ${constats.length - graves - suspects} info.\n`);

// Sortie non nulle en cas de constat grave : le workflow qualité échoue, et le
// défaut se voit tout de suite au lieu d'attendre qu'un humain le remarque.
if (graves > 0) process.exitCode = 1;
