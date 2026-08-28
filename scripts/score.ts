/**
 * Recalcule tous les scores sans relancer de crawl.
 *
 *   npm run score
 *
 * Utile après avoir modifié les pondérations du moteur : on voit l'effet
 * immédiatement sur les données déjà en base, sans refaire une seule requête
 * réseau.
 */
import { migrate } from '../src/lib/db/index';
import { scoreAll } from '../src/lib/pricing/score';

migrate();
const started = Date.now();
const n = scoreAll();
console.log(`${n} scores calculés en ${((Date.now() - started) / 1000).toFixed(1)}s.`);
