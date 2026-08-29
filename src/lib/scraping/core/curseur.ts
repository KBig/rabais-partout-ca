import { db, nowIso } from '../../db/index';

/**
 * OU REPRENDRE LE PARCOURS D'UN CATALOGUE.
 *
 * Un marchand dont le catalogue depasse ce qu'un passage peut lire ne sera
 * jamais parcouru en entier si chaque passage repart du debut. Best Buy en est
 * l'exemple : 282 000 produits, un plafond de 12 000 par cycle, et donc
 * toujours les MEMES 4 % rafraichis — les 270 000 autres n'avaient aucun
 * releve, sans qu'aucune erreur ne le signale.
 *
 * Retenir la page suivante rend la couverture complete en quelques cycles et,
 * surtout, PREVISIBLE : chaque produit revient a intervalle regulier, ce qui
 * est la condition pour dater une baisse de prix.
 */

export interface Curseur {
  page: number;
  /** Tours complets acheves. Zero = jamais parcouru jusqu'au bout. */
  laps: number;
}

const NEUF: Curseur = { page: 1, laps: 0 };

/** Ou reprendre pour ce rayon. Page 1 s'il n'a jamais ete parcouru. */
export function pageDeReprise(storeId: string, scope = ''): Curseur {
  const r = db()
    .prepare<[string, string], { next_page: number; laps: number }>(
      'SELECT next_page, laps FROM crawl_cursors WHERE store_id = ? AND scope = ?',
    )
    .get(storeId, scope);
  return r ? { page: Math.max(1, r.next_page), laps: r.laps } : NEUF;
}

/** Les curseurs de plusieurs rayons d'un coup, pour les ordonner sans N requetes. */
export function curseursDe(storeId: string): Map<string, Curseur> {
  return new Map(
    db()
      .prepare<[string], { scope: string; next_page: number; laps: number }>(
        'SELECT scope, next_page, laps FROM crawl_cursors WHERE store_id = ?',
      )
      .all(storeId)
      .map((r) => [r.scope, { page: Math.max(1, r.next_page), laps: r.laps }]),
  );
}

/**
 * Enregistre l'avancement.
 *
 * `finDuRayon` est vrai quand une page est revenue vide : on est alle au bout.
 * Le tour suivant repart de la page 1 et le compteur de tours avance — c'est
 * cette remise a zero qui garantit que le DEBUT du catalogue est revu, et pas
 * seulement sa fin.
 */
export function avancerCurseur(
  storeId: string,
  scope: string,
  pageSuivante: number,
  finDuRayon: boolean,
): void {
  db()
    .prepare<[string, string, number, number, string]>(
      `INSERT INTO crawl_cursors (store_id, scope, next_page, laps, updated_at)
            VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(store_id, scope) DO UPDATE
              SET next_page  = excluded.next_page,
                  laps       = crawl_cursors.laps + excluded.laps,
                  updated_at = excluded.updated_at`,
    )
    .run(storeId, scope, finDuRayon ? 1 : Math.max(1, pageSuivante), finDuRayon ? 1 : 0, nowIso());
}

/**
 * Ordonne des rayons du MOINS couvert au plus couvert.
 *
 * Sans cela, un rayon termine repartirait de sa page 1 au cycle suivant et
 * consommerait tout le budget avant que ses voisins aient ete vus une seule
 * fois — le curseur n'aurait fait que deplacer le probleme.
 *
 * A nombre de tours egal, on finit d'abord ce qui est deja entame : un rayon
 * laisse a la page 8 passe devant un rayon jamais touche.
 */
export function parCouverture<T>(items: T[], scopeDe: (x: T) => string, curseurs: Map<string, Curseur>): T[] {
  return [...items].sort((a, b) => {
    const ca = curseurs.get(scopeDe(a)) ?? NEUF;
    const cb = curseurs.get(scopeDe(b)) ?? NEUF;
    return ca.laps !== cb.laps ? ca.laps - cb.laps : cb.page - ca.page;
  });
}
