import { hostname } from 'node:os';

import { db, nowIso } from '../../db';
import { processusVivant } from './processus';
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
 * UN DELAI NE SUFFISAIT PAS A LE DIRE. Presumer la mort au bout de quatre-vingt
 * -dix minutes se trompe dans les deux sens : trop court, on coupe une passe
 * Costco encore active ; trop long, un simple Ctrl+C interdit de recollecter
 * pendant une heure et demie. Costco a ete ignore a quatre-vingt-huit minutes
 * pour cette raison exacte. On demande donc au systeme, qui SAIT.
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
 * Dernier recours quand on ne peut PAS interroger le systeme : une collecte
 * partie d'une autre machine. Genereux a dessein — une passe Costco legitime
 * dure une demi-heure, et liberer trop tot est pire que liberer trop tard.
 */
const VERROU_PERIME_MIN = 90;

/** Cette machine. Deux collectes ne se croisent que si elles la partagent. */
const ICI = hostname();

interface LigneVerrou {
  id: number;
  store_id: string;
  started_at: string;
  pid: number | null;
  host: string | null;
}

/**
 * Ce verrou est-il mort ?
 *
 * On demande au systeme quand on peut, on presume quand on ne peut pas. Un
 * verrou pose ici par un processus disparu est declare mort IMMEDIATEMENT :
 * plus d'attente de quatre-vingt-dix minutes apres un Ctrl+C.
 */
function verrouMort(r: LigneVerrou, limiteIso: string): boolean {
  if (r.host === ICI && r.pid !== null) return !processusVivant(r.pid);
  // Autre machine, ou ligne anterieure a la migration 028 : on ne peut rien
  // demander au systeme d'ici. Le delai reste le seul recours honnete.
  return r.started_at < limiteIso;
}

function verrousActifs(storeId?: string): LigneVerrou[] {
  const sql =
    `SELECT id, store_id, started_at, pid, host FROM crawl_runs
      WHERE status = 'running'` + (storeId ? ' AND store_id = ?' : '');
  const st = db().prepare<string[], LigneVerrou>(sql);
  return storeId ? st.all(storeId) : st.all();
}

/**
 * Libere les verrous laisses par des processus disparus.
 *
 * A appeler au demarrage de toute commande de collecte : un plantage, un
 * Ctrl+C ou une machine eteinte laissent sinon une ligne « running » qui
 * interdirait de recollecter ce magasin.
 */
export function libererVerrousPerimes(log: (m: string) => void = () => {}): number {
  const limite = new Date(Date.now() - VERROU_PERIME_MIN * 60_000).toISOString();
  const morts = verrousActifs().filter((r) => verrouMort(r, limite));
  if (morts.length === 0) return 0;

  const st = db().prepare<[string, number]>(
    `UPDATE crawl_runs
        SET status = 'failed',
            error = COALESCE(error, 'interrompu : processus disparu'),
            finished_at = ?
      WHERE id = ?`,
  );
  const t = nowIso();
  db().transaction(() => morts.forEach((r) => st.run(t, r.id)))();

  log(`  ${morts.length} collecte(s) interrompue(s) liberee(s)`);
  return morts.length;
}

/** Une collecte de ce magasin est-elle reellement en cours ? */
export function collecteEnCours(storeId: string): boolean {
  const limite = new Date(Date.now() - VERROU_PERIME_MIN * 60_000).toISOString();
  return verrousActifs(storeId).some((r) => !verrouMort(r, limite));
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
