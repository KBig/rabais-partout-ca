import { db } from '../../db';

/**
 * MISE EN COHÉRENCE APRÈS COLLECTE.
 *
 * Trois défauts que le marchand nous transmet tels quels, et qu'aucune règle
 * d'extraction ne peut corriger produit par produit — ils ne se voient qu'en
 * regardant le catalogue entier.
 *
 * Cette passe ne fabrique rien : elle rapproche des faits déjà présents.
 *
 * ----------------------------------------------------------------------------
 * DEUX CONTRAINTES QUI ONT COÛTÉ CHER
 * ----------------------------------------------------------------------------
 *
 * ORDRE. Une première version rapprochait les images en comparant les titres
 * normalisés à l'intérieur d'une sous-requête corrélée : 294 000 lignes
 * confrontées à 294 000 lignes, sans index utilisable. Elle tournait encore au
 * bout de dix minutes. La clé de variante est donc calculée D'ABORD, une seule
 * fois, puis indexée — tout le reste s'y appuie.
 *
 * DÉCOUPAGE. SQLite n'accepte qu'un écrivain à la fois. Cette même version a
 * tenu le verrou dix minutes et fait échouer trois collectes en parallèle sur
 * SQLITE_BUSY. Chaque écriture est maintenant découpée en lots courts, comme
 * le calcul des scores et l'index de caractéristiques.
 */

/** Nombre de lignes par transaction. Assez court pour libérer le verrou. */
const TAILLE_LOT = 20_000;

/**
 * Titre débarrassé de la mention d'état.
 *
 * « Boîte ouverte - Casque X » et « Casque X » sont le même appareil : l'un est
 * une unité reprise de l'autre. Les rapprocher permet d'hériter la photo, et de
 * ne pas afficher trois fois le même article dans une liste.
 */
const NORMALISER = `
  TRIM(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
      LOWER(title),
      'boîte ouverte - ', ''), 'boite ouverte - ', ''), 'open box - ', ''),
      'remis à neuf - ', ''), 'remis a neuf - ', ''), 'refurbished - ', '')
  )
`;

/** Combien d'articles actifs n'ont aucune image ? */
function compterSansImage(conn: ReturnType<typeof db>): number {
  return (
    conn
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) n FROM products
          WHERE is_active = 1 AND (image_url IS NULL OR image_url = '')`,
      )
      .get()?.n ?? 0
  );
}

export interface CoherenceResult {
  variantes: number;
  imagesHeritees: number;
  notesNettoyees: number;
}

/** Exécute une écriture par tranches d'identifiants. */
function parLots(conn: ReturnType<typeof db>, sql: string): number {
  const bornes = conn
    .prepare<[], { mini: number | null; maxi: number | null }>(
      'SELECT MIN(id) mini, MAX(id) maxi FROM products',
    )
    .get();
  if (!bornes?.mini || !bornes.maxi) return 0;

  const requete = conn.prepare<[number, number]>(sql);
  let total = 0;
  for (let bas = bornes.mini; bas <= bornes.maxi; bas += TAILLE_LOT) {
    total += conn.transaction(() => requete.run(bas, bas + TAILLE_LOT - 1).changes)();
  }
  return total;
}

export function reconcile(log: (m: string) => void = () => {}): CoherenceResult {
  const conn = db();

  // --- 1. Clé de variante, calculée en premier : tout le reste s'y appuie ---
  const variantes = parLots(
    conn,
    `UPDATE products SET variant_key = ${NORMALISER}
      WHERE is_active = 1 AND id BETWEEN ? AND ?`,
  );

  // --- 2. Une unité boîte ouverte est le même produit que le neuf ----------
  //
  // 1 292 articles n'avaient aucune image, presque tous en boîte ouverte : le
  // marchand ne photographie pas chaque unité reprise. L'appareil est pourtant
  // identique au neuf, dont la photo existe. On la reprend plutôt que
  // d'afficher « image indisponible » sur un produit illustré deux lignes plus
  // haut.
  //
  // DEUX rapprochements, du plus sûr au plus large :
  //
  //   par MODÈLE — deux articles portant la même référence sont le même
  //   appareil, quoi que disent leurs titres ;
  //
  //   par TITRE NORMALISÉ — pour les produits sans référence. Best Buy ne
  //   reprend pas toujours le titre du neuf à l'identique sur une unité
  //   reprise, ce qui limite la portée de ce second passage.
  const manquantesAvant = compterSansImage(conn);

  parLots(
    conn,
    `UPDATE products AS cible
        SET image_url = (
          SELECT src.image_url FROM products src
           WHERE src.store_id = cible.store_id
             AND src.model = cible.model
             AND src.image_url IS NOT NULL AND src.image_url <> ''
           LIMIT 1
        )
      WHERE cible.is_active = 1
        AND cible.id BETWEEN ? AND ?
        AND (cible.image_url IS NULL OR cible.image_url = '')
        AND cible.model IS NOT NULL AND cible.model <> ''`,
  );

  parLots(
    conn,
    `UPDATE products AS cible
        SET image_url = (
          SELECT src.image_url FROM products src
           WHERE src.store_id = cible.store_id
             AND src.variant_key = cible.variant_key
             AND src.image_url IS NOT NULL AND src.image_url <> ''
           LIMIT 1
        )
      WHERE cible.is_active = 1
        AND cible.id BETWEEN ? AND ?
        AND (cible.image_url IS NULL OR cible.image_url = '')
        AND cible.variant_key IS NOT NULL`,
  );

  // On compte les images REELLEMENT trouvees, pas les lignes touchees.
  // `changes` renvoie le nombre de lignes visitees par l'UPDATE, y compris
  // celles ou la sous-requete n'a rien ramene et a reecrit un NULL par un
  // NULL — soit, la premiere fois, 1 292 « reussites » pour 31 images.
  const imagesHeritees = manquantesAvant - compterSansImage(conn);

  // --- 3. Une note sans avis n'est pas une note ----------------------------
  //
  // Le marchand renvoie parfois « 4,0 sur 5 » avec zéro avis. Affiché tel quel,
  // c'est un jugement sorti de nulle part — et le moteur de qualité le
  // prendrait pour une mesure. Sans avis, on ne sait pas.
  const notesNettoyees = parLots(
    conn,
    `UPDATE products SET rating = NULL
      WHERE is_active = 1 AND id BETWEEN ? AND ?
        AND rating IS NOT NULL AND COALESCE(rating_count, 0) = 0`,
  );

  log(
    `  cohérence : ${variantes} clé(s) de variante, ${imagesHeritees} image(s) héritée(s), ` +
      `${notesNettoyees} note(s) sans avis retirée(s)`,
  );

  return { variantes, imagesHeritees, notesNettoyees };
}

/**
 * Désigne UN représentant par groupe de variantes.
 *
 * Un bracelet de montre existe en 69 couleurs, chacune avec son identifiant.
 * Une page de rayon affichait donc 69 cartes identiques au même prix, et
 * repoussait tout le reste hors écran — 7 264 groupes de ce type.
 *
 * Appelé après le calcul des scores, puisque le représentant est celui qui
 * ressort le mieux. Les autres restent actifs : cherchables, accessibles par
 * leur adresse, simplement absents du classement.
 */
export function electVariantLeads(): number {
  const conn = db();

  return conn.transaction(() => {
    conn.prepare('UPDATE deal_scores SET is_variant_lead = 1 WHERE is_active = 1').run();

    // Une fonction de fenêtrage classe chaque groupe en UNE passe. La version
    // précédente employait un EXISTS corrélé, soit un balayage par ligne.
    return conn
      .prepare(
        `UPDATE deal_scores SET is_variant_lead = 0
          WHERE product_id IN (
            SELECT product_id FROM (
              SELECT s.product_id,
                     ROW_NUMBER() OVER (
                       PARTITION BY p.store_id, p.variant_key
                       ORDER BY s.score DESC, s.product_id ASC
                     ) AS rang
                FROM deal_scores s
                JOIN products p ON p.id = s.product_id
               WHERE s.is_active = 1 AND p.variant_key IS NOT NULL
            ) WHERE rang > 1
          )`,
      )
      .run().changes;
  })();
}
