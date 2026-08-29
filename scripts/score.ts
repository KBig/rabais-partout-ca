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
import { reconcile, electVariantLeads } from '../src/lib/scraping/core/coherence';

migrate();
const started = Date.now();
reconcile((m) => console.log(m));
const n = scoreAll();
const masquees = electVariantLeads();
if (masquees > 0) console.log(`${masquees} variante(s) masquee(s) du classement.`);
console.log(`${n} scores calculés en ${((Date.now() - started) / 1000).toFixed(1)}s.`);
