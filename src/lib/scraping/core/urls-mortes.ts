import { db, nowIso } from '../../db/index';

/**
 * LES ADRESSES DONT ON SAIT QU'ELLES NE RENDENT PLUS RIEN.
 *
 * Certains marchands publient un sitemap qui garde les fiches retirees du
 * catalogue. Chez Costco, 82 % des 8 775 adresses annoncees repondent 404 :
 * 115 requetes par passage pour 14 produits releves. A ce rythme le catalogue
 * n'est jamais parcouru, donc jamais rafraichi.
 *
 * Retenir ces adresses ne rend pas la collecte « plus rapide » au sens d'un
 * reglage : elle cesse simplement de redemander ce dont on sait deja que ca
 * n'existe plus.
 */

/** Deux echecs avant de conclure : un 404 isole peut etre un accident. */
const SEUIL = 2;

/** Un article retire peut revenir. Passe ce delai, l'adresse est retentee. */
const PEREMPTION_JOURS = 30;

/** Les adresses a ne plus demander pour ce magasin. */
export function urlsMortes(storeId: string): Set<string> {
  const limite = new Date(Date.now() - PEREMPTION_JOURS * 86_400_000).toISOString();
  return new Set(
    db()
      .prepare<[string, number, string], { url: string }>(
        'SELECT url FROM url_mortes WHERE store_id = ? AND echecs >= ? AND dernier >= ?',
      )
      .all(storeId, SEUIL, limite)
      .map((r) => r.url),
  );
}

/**
 * Note un echec DEFINITIF — 404, 410, ou page servie sans fiche produit.
 *
 * A ne jamais appeler pour un echec passager (429, 5xx, delai depasse) : ce
 * serait effacer de la collecte une adresse parfaitement valide, et rien ne
 * viendrait le signaler.
 *
 * `certain` distingue deux niveaux de preuve. Un 404 est sans ambiguite : le
 * serveur affirme que la ressource n'existe pas, et une deuxieme demande
 * n'apprendrait rien de plus — l'exiger couterait ici sept mille requetes pour
 * confirmer ce qu'on sait deja. Une page servie SANS fiche produit est plus
 * douteuse : mise en page changee, rendu incomplet, blocage silencieux. Celle-la
 * merite une seconde chance.
 */
export function noterUrlMorte(storeId: string, url: string, certain = false): void {
  const poids = certain ? SEUIL : 1;
  db()
    .prepare<[string, string, number, string, number]>(
      `INSERT INTO url_mortes (store_id, url, echecs, dernier) VALUES (?, ?, ?, ?)
       ON CONFLICT(store_id, url) DO UPDATE
              SET echecs = url_mortes.echecs + ?, dernier = excluded.dernier`,
    )
    .run(storeId, url, poids, nowIso(), poids);
}

/** L'adresse repond de nouveau : on efface son ardoise. */
export function noterUrlVivante(storeId: string, url: string): void {
  db()
    .prepare<[string, string]>('DELETE FROM url_mortes WHERE store_id = ? AND url = ?')
    .run(storeId, url);
}

export function compterUrlsMortes(storeId: string): number {
  return (
    db()
      .prepare<[string, number], { n: number }>(
        'SELECT COUNT(*) n FROM url_mortes WHERE store_id = ? AND echecs >= ?',
      )
      .get(storeId, SEUIL)?.n ?? 0
  );
}
