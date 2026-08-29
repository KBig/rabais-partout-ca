import { db, nowIso } from '../db';
import { extractSpecs, type Spec } from '../specs';

/**
 * ANALYSE COMPOSANTE PAR COMPOSANTE.
 *
 * ----------------------------------------------------------------------------
 * CE QUE ÇA RÉPOND
 * ----------------------------------------------------------------------------
 *
 * « Ce portable est-il un bon achat ? » ne se règle pas avec un prix. Il se
 * règle composante par composante : le processeur est-il correct, la mémoire
 * généreuse, l'écran dans la moyenne ? Un appareil peut cacher une pièce
 * d'entrée de gamme derrière deux pièces flatteuses.
 *
 * La même question vaut pour un réfrigérateur (volume), un aspirateur robot
 * (autonomie), une friteuse (capacité) : partout, une caractéristique ne veut
 * rien dire tant qu'on ne sait pas à quoi la comparer.
 *
 * ----------------------------------------------------------------------------
 * DEUX MÉCANISMES, PARCE QU'IL Y A DEUX SORTES DE CARACTÉRISTIQUES
 * ----------------------------------------------------------------------------
 *
 *   ÉCHELLE CONNUE — une dalle OLED bat une QLED, un Ryzen 9 bat un Ryzen 3,
 *   le Wi-Fi 7 bat le Wi-Fi 6. Ces ordres sont établis par les fabricants
 *   eux-mêmes ; ils sont écrits une fois dans les règles et ne bougent pas.
 *
 *   DISTRIBUTION MESURÉE — « 16 Go », « 5,7 L », « 165 Hz » n'ont aucune
 *   échelle absolue. On les confronte à ce que fait RÉELLEMENT le marché, en
 *   calculant les déciles sur le catalogue, catégorie par catégorie.
 *
 * Le second mécanisme est le plus important : il se met à jour tout seul, il
 * couvre des familles qu'on n'a pas anticipées, et il dit littéralement « par
 * rapport à ce qui se fait ». Une table de valeurs écrite à la main serait
 * fausse dans six mois.
 *
 * ----------------------------------------------------------------------------
 * QUAND ON NE DIT RIEN
 * ----------------------------------------------------------------------------
 *
 * En dessous de MIN_SAMPLE observations, aucun verdict n'est rendu. Classer
 * une valeur d'après huit produits reviendrait à inventer une moyenne de
 * marché. La caractéristique reste affichée, expliquée, sans étiquette.
 */

/** En dessous, la distribution ne représente pas un marché. */
const MIN_SAMPLE = 30;

export type Gamme = 'entree' | 'milieu' | 'haut' | 'premium';

export const GAMME_LABEL: Record<Gamme, string> = {
  entree: 'Entrée de gamme',
  milieu: 'Milieu de gamme',
  haut: 'Haut de gamme',
  premium: 'Très haut de gamme',
};

export interface ComponentVerdict {
  spec: Spec;
  gamme?: Gamme;
  /** Comment le verdict a été obtenu — affiché pour qu'il soit vérifiable. */
  basis?: string;
}

/** Clé de distribution : la famille seule ne suffit pas, l'unité en fait partie. */
const metricKey = (s: Spec) => `${s.family}|${s.unit ?? ''}`;

export interface Distribution {
  n: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/**
 * Cache mémoire des distributions.
 *
 * Elles ne changent qu'après un recalcul complet, et la fiche produit en
 * consulte une par caractéristique : les relire en base à chaque affichage
 * serait un aller-retour par ligne pour une donnée figée.
 */
let cache: Map<string, Distribution> | null = null;

function distributions(): Map<string, Distribution> {
  if (cache) return cache;
  const m = new Map<string, Distribution>();
  const rows = db()
    .prepare<[], { category_slug: string; metric_key: string } & Distribution>(
      'SELECT category_slug, metric_key, n, p10, p25, p50, p75, p90 FROM spec_distribution',
    )
    .all();
  for (const r of rows) {
    m.set(`${r.category_slug}::${r.metric_key}`, r);
  }
  cache = m;
  return m;
}

export function invalidateDistributionCache() {
  cache = null;
}

/** Place une valeur dans sa distribution. */
export function gammeFromDistribution(spec: Spec, d: Distribution): { gamme: Gamme; basis: string } {
  const v = spec.metric!;

  // La médiane sert de garde-fou dans les deux sens.
  //
  // Sans elle, une caractéristique très concentrée produisait des verdicts
  // absurdes : chez les portables, p25 et p50 valent tous deux 144 Hz, et un
  // écran de 144 Hz — exactement la médiane — se retrouvait classé « entrée de
  // gamme » parce qu'il satisfaisait « v <= p25 ». Être dans la moyenne n'est
  // jamais être en dessous.
  const meilleur = spec.lowerIsBetter ? v < d.p50 : v > d.p50;
  const pire = spec.lowerIsBetter ? v > d.p50 : v < d.p50;

  const haut = meilleur && (spec.lowerIsBetter ? v <= d.p10 : v >= d.p90);
  const bon = meilleur && (spec.lowerIsBetter ? v <= d.p25 : v >= d.p75);
  const faible = pire && (spec.lowerIsBetter ? v >= d.p75 : v <= d.p25);

  const gamme: Gamme = haut ? 'premium' : bon ? 'haut' : faible ? 'entree' : 'milieu';

  // Une decimale suffit pour des pouces ou des litres, pas pour des
  // millisecondes : « 0,03 ms » s'affichait « 0.0 ms », ce qui ne veut rien
  // dire. On garde assez de chiffres pour que la valeur reste reconnaissable.
  const mediane =
    d.p50 % 1 === 0 ? d.p50 : d.p50 < 1 ? d.p50.toFixed(2) : d.p50.toFixed(1);
  return {
    gamme,
    basis: `Médiane de la catégorie : ${mediane} ${spec.unit ?? ''} (${d.n} produits comparés)`.trim(),
  };
}

/** Place un échelon sur son échelle connue. */
export function gammeFromRank(spec: Spec): { gamme: Gamme; basis: string } {
  const rank = spec.rank!;
  const scale = spec.scale ?? 4;

  // Une échelle à deux échelons n'exprime qu'une présence : la traiter comme un
  // sommet ferait passer un simple SSD pour du très haut de gamme.
  if (scale <= 2) {
    return {
      gamme: rank >= scale ? 'haut' : 'entree',
      basis: 'Échelle technique établie',
    };
  }

  const ratio = rank / scale;
  const gamme: Gamme =
    ratio >= 1 ? 'premium' : ratio >= 0.75 ? 'haut' : ratio >= 0.5 ? 'milieu' : 'entree';

  return { gamme, basis: `Échelon ${rank} sur ${scale} de sa gamme` };
}

/**
 * Analyse un produit, caractéristique par caractéristique.
 *
 * L'échelle connue prime sur la distribution : quand un ordre technique existe,
 * il est plus sûr qu'une statistique de catalogue, où un même terme peut se
 * retrouver dans des produits très différents.
 */
export function analyzeComponents(
  title: string,
  description: string | null | undefined,
  categorySlug: string | null,
): ComponentVerdict[] {
  const specs = extractSpecs(title, description, categorySlug);
  const dist = distributions();

  return specs.map((spec): ComponentVerdict => {
    if (spec.rank !== undefined) return { spec, ...gammeFromRank(spec) };

    if (spec.metric !== undefined && categorySlug) {
      const d = dist.get(`${categorySlug}::${metricKey(spec)}`);
      if (d && d.n >= MIN_SAMPLE) return { spec, ...gammeFromDistribution(spec, d) };
    }

    // Ni échelle ni comparaison possible : la caractéristique reste utile à
    // lire, mais nous n'avons rien de solide à en dire.
    return { spec };
  });
}

/** Résumé d'un produit : combien de pièces au-dessus, combien en dessous. */
export function componentSummary(verdicts: ComponentVerdict[]) {
  const classes = verdicts.filter((v) => v.gamme);
  const haut = classes.filter((v) => v.gamme === 'haut' || v.gamme === 'premium').length;
  const entree = classes.filter((v) => v.gamme === 'entree').length;
  return { total: classes.length, haut, entree };
}

// ---------------------------------------------------------------------------
// Construction de la distribution
// ---------------------------------------------------------------------------

function percentile(tries: number[], p: number): number {
  if (tries.length === 0) return 0;
  const i = (tries.length - 1) * p;
  const bas = Math.floor(i);
  const haut = Math.ceil(i);
  if (bas === haut) return tries[bas];
  return tries[bas] + (tries[haut] - tries[bas]) * (i - bas);
}

export interface DistributionStats {
  produits: number;
  cles: number;
  retenues: number;
  caracteristiques: number;
}

/**
 * Valeur de filtre : stable, sans accent ni espace.
 *
 * L'etiquette affichee peut changer de formulation sans casser les liens de
 * filtre deja partages, tant que la valeur reste la meme.
 */
const filterValue = (label: string) =>
  label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Recalcule la distribution de chaque caractéristique numérique.
 *
 * À lancer après une collecte : le marché bouge, les valeurs de référence
 * doivent bouger avec lui.
 */
export function buildSpecDistribution(log: (m: string) => void = () => {}): DistributionStats {
  const conn = db();

  const produits = conn
    .prepare<[], {
      id: number;
      title: string;
      description: string | null;
      category_slug: string | null;
    }>(
      `SELECT id, title, description, category_slug FROM products
        WHERE is_active = 1 AND category_slug IS NOT NULL`,
    )
    .all();

  log(`  ${produits.length} produits à analyser…`);

  const insertSpec = conn.prepare<[number, string, string, string, number | null]>(
    `INSERT INTO product_specs (product_id, family, label, value, metric)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(product_id, family) DO UPDATE SET
       label = excluded.label, value = excluded.value, metric = excluded.metric`,
  );

  const valeurs = new Map<string, number[]>();
  let caracteristiques = 0;

  // Une seule passe d'extraction sert les deux usages : la distribution
  // statistique et l'index de filtrage. Extraire deux fois finirait par
  // produire deux verites differentes.
  //
  // L'ecriture est DECOUPEE. SQLite n'accepte qu'un ecrivain a la fois : une
  // transaction unique sur pres de deux millions de lignes tiendrait le verrou
  // assez longtemps pour faire echouer une collecte lancee en parallele. Des
  // lots courts laissent les deux travaux avancer ensemble.
  conn.prepare('DELETE FROM product_specs').run();

  const TAILLE_LOT = 20_000;
  const ecrireLot = conn.transaction((lot: typeof produits) => {
    for (const p of lot) {
      for (const spec of extractSpecs(p.title, p.description, p.category_slug)) {
        insertSpec.run(
          p.id,
          spec.family,
          spec.label,
          filterValue(spec.label),
          spec.metric ?? null,
        );
        caracteristiques++;

        if (spec.metric === undefined) continue;
        const cle = `${p.category_slug}::${metricKey(spec)}`;
        const liste = valeurs.get(cle);
        if (liste) liste.push(spec.metric);
        else valeurs.set(cle, [spec.metric]);
      }
    }
  });

  for (let i = 0; i < produits.length; i += TAILLE_LOT) {
    ecrireLot(produits.slice(i, i + TAILLE_LOT));
  }

  log(`  ${caracteristiques} caractéristiques indexées.`);

  const insert = conn.prepare(
    `INSERT INTO spec_distribution
       (category_slug, metric_key, n, p10, p25, p50, p75, p90, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(category_slug, metric_key) DO UPDATE SET
       n = excluded.n, p10 = excluded.p10, p25 = excluded.p25, p50 = excluded.p50,
       p75 = excluded.p75, p90 = excluded.p90, computed_at = excluded.computed_at`,
  );

  const ts = nowIso();
  let retenues = 0;

  conn.transaction(() => {
    conn.prepare('DELETE FROM spec_distribution').run();
    for (const [cle, liste] of valeurs) {
      if (liste.length < MIN_SAMPLE) continue;
      liste.sort((a, b) => a - b);
      const [categorie, metric] = cle.split('::');
      insert.run(
        categorie,
        metric,
        liste.length,
        percentile(liste, 0.1),
        percentile(liste, 0.25),
        percentile(liste, 0.5),
        percentile(liste, 0.75),
        percentile(liste, 0.9),
        ts,
      );
      retenues++;
    }
  })();

  invalidateDistributionCache();
  log(`  ${valeurs.size} combinaisons vues, ${retenues} retenues (seuil ${MIN_SAMPLE}).`);

  return { produits: produits.length, cles: valeurs.size, retenues, caracteristiques };
}
