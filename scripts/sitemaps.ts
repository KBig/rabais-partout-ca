/**
 * Construit l'index modèle → URL des fabricants, depuis leurs sitemaps.
 *
 *   npm run sitemaps
 *
 * À lancer rarement : un catalogue constructeur ne bouge qu'au rythme des
 * sorties. L'index est ensuite consulté à chaque enrichissement sans coût
 * réseau.
 */
import { migrate } from '../src/lib/db/index';
import { HttpClient } from '../src/lib/scraping/core/http';
import { BRAND_SITES } from '../src/lib/enrichment/sources/manufacturer';
import { buildSitemapIndex, indexIsStale } from '../src/lib/enrichment/sources/sitemap';

const flag = (n: string) => process.argv.includes(`--${n}`);

migrate();

const http = new HttpClient({ requestsPerSecond: 1 });
const facade = {
  getJson: <T>(url: string) => http.getJson<T>(url),
  getText: (url: string) => http.getText(url),
};

const cibles = BRAND_SITES.filter((b) => b.sitemapUrl);
console.log(`${cibles.length} marque(s) avec un sitemap déclaré.\n`);

for (const b of cibles) {
  if (!flag('force') && !indexIsStale(b.brand)) {
    console.log(`  ${b.name} : index à jour, ignoré (--force pour reconstruire)`);
    continue;
  }
  try {
    await buildSitemapIndex(b.brand, b.sitemapUrl!, facade, (m) => console.log(m), b.urlFilter);
  } catch (err) {
    console.log(`  ${b.name} : échec — ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`\n${http.requestCount} requêtes.`);
