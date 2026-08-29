import { db, nowIso } from '../../db';
import { liveStores } from '../registry';
import type { StoreMeta } from '../types';

/**
 * QUI COLLECTER, ET QUAND.
 *
 * ----------------------------------------------------------------------------
 * DEUX DEFAUTS QUE CE FICHIER CORRIGE
 * ----------------------------------------------------------------------------
 *
 * RIEN N'EMPECHAIT DEUX COLLECTES DU MEME MAGASIN. Lancees en parallele, elles
 * se disputent la cadence autorisee et le verrou d'ecriture : chacune croit
 * aller a la vitesse permise, les deux avancent deux fois moins vite, et les
 * mesures deviennent fausses. C'est arrive quatre fois de suite sur IKEA.
 *
 * Et chaque processus interrompu laissait sa ligne `crawl_runs` en « running »
 * pour toujours — onze au dernier compte. Un verrou qui ne se libere jamais
 * bloquerait bientot tout.
 *
 * L'ORDRE DE PASSAGE ETAIT AVEUGLE. Une rotation fixe ne regarde pas ce qui a
 * besoin d'etre rafraichi : Best Buy est reste dix-neuf heures sans releve
 * pendant qu'IKEA etait collecte trois fois de suite.
 *
 * ----------------------------------------------------------------------------
 * LE PRINCIPE
 * ----------------------------------------------------------------------------
 *
 * On collecte d'abord LE PLUS PERIME. C'est la seule regle, et elle se suffit :
 * un magasin frais attend, un magasin oublie passe devant. L'historique de prix
 * s'en trouve regulier pour tout le monde, ce qui est exactement ce qu'on veut
 * mesurer.
 */

/**
 * Au-dela, une collecte « en cours » est consideree comme morte.
 *
 * Genereux a dessein : une passe Costco legitime dure une demi-heure. Ce qui
 * compte est de ne pas rester bloque indefiniment, pas de reagir vite.
 */
const VERROU_PERIME_MIN = 90;

/**
 * Libere les verrous laisses par des processus disparus.
 *
 * A appeler au demarrage de toute commande de collecte : un plantage, un
 * Ctrl+C ou une machine eteinte laissent sinon une ligne « running » qui
 * interdirait a jamais de recollecter ce magasin.
 */
export function libererVerrousPerimes(log: (m: string) => void = () => {}): number {
  const limite = new Date(Date.now() - VERROU_PERIME_MIN * 60_000).toISOString();

  const n = db()
    .prepare<[string, string]>(
      `UPDATE crawl_runs
          SET status = 'failed',
              error = COALESCE(error, 'interrompu : processus disparu'),
              finished_at = ?
        WHERE status = 'running' AND started_at < ?`,
    )
    .run(nowIso(), limite).changes;

  if (n > 0) log(`  ${n} collecte(s) interrompue(s) liberee(s)`);
  return n;
}

/** Une collecte de ce magasin est-elle deja en cours ? */
export function collecteEnCours(storeId: string): boolean {
  const limite = new Date(Date.now() - VERROU_PERIME_MIN * 60_000).toISOString();
  const r = db()
    .prepare<[string, string], { n: number }>(
      `SELECT COUNT(*) n FROM crawl_runs
        WHERE store_id = ? AND status = 'running' AND started_at >= ?`,
    )
    .get(storeId, limite);
  return (r?.n ?? 0) > 0;
}

export interface MagasinAPrendre {
  store: StoreMeta;
  /** Heures ecoulees depuis le dernier releve. `null` si jamais collecte. */
  heures: number | null;
  produits: number;
}

/**
 * Les magasins, du plus perime au plus frais.
 *
 * Un magasin jamais collecte passe en tete : il n'a aucun historique, et c'est
 * le manque le plus grand.
 */
export function magasinsParPeremption(): MagasinAPrendre[] {
  const fraicheur = new Map(
    db()
      .prepare<[], { store_id: string; vu: string | null; n: number }>(
        `SELECT store_id, MAX(last_seen_at) vu, COUNT(*) n
           FROM products WHERE is_active = 1 GROUP BY store_id`,
      )
      .all()
      .map((r) => [r.store_id, r]),
  );

  const maintenant = Date.now();

  return liveStores()
    .map((store) => {
      const f = fraicheur.get(store.id);
      const heures = f?.vu ? (maintenant - Date.parse(f.vu)) / 3_600_000 : null;
      return { store, heures, produits: f?.n ?? 0 };
    })
    .sort((a, b) => {
      // Jamais collecte d'abord, puis du plus ancien releve au plus recent.
      if (a.heures === null && b.heures !== null) return -1;
      if (b.heures === null && a.heures !== null) return 1;
      return (b.heures ?? 0) - (a.heures ?? 0);
    });
}
