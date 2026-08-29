import { db, nowIso } from '../../db';
import type { EnrichmentHttp } from '../types';

/**
 * DÉCOUVERTE DES FICHES FABRICANT PAR SITEMAP.
 *
 * ----------------------------------------------------------------------------
 * LE PROBLÈME QUE ÇA RÉSOUT
 * ----------------------------------------------------------------------------
 *
 * L'extraction du prix chez un fabricant fonctionne bien : la plupart publient
 * un `Product` en JSON-LD sur leurs fiches. Ce qui bloquait, c'était l'étape
 * d'avant — **trouver l'URL de la fiche à partir d'un numéro de modèle**.
 *
 * Première tentative : interroger le moteur de recherche du site. Échec net.
 * Ces pages sont rendues en JavaScript ; le modèle recherché n'apparaît même
 * pas dans le HTML servi, et aucun lien produit n'est suivable.
 *
 * ----------------------------------------------------------------------------
 * LA SOLUTION
 * ----------------------------------------------------------------------------
 *
 * Les **sitemaps** sont un standard du web (sitemaps.org) : du XML statique,
 * publié précisément pour être parcouru par des robots, et qui liste les fiches
 * produit d'un site. Rien à exécuter, rien à contourner.
 *
 * Vérifié sur Samsung : le sitemap « vd » contient 849 URL, et **36 de nos 40
 * modèles Samsung y sont retrouvés**, avec l'adresse directe de leur fiche.
 *
 * L'index est construit une fois puis conservé en base : le reconstruire à
 * chaque produit serait absurde, et les sitemaps ne changent qu'au rythme du
 * catalogue.
 */

/** Un sitemap peut renvoyer vers d'autres sitemaps. On limite la descente. */
const MAX_DEPTH = 3;

/**
 * Au-dela, on cesse de suivre : ce n'est plus un catalogue produit.
 *
 * Le plafond est plus haut quand un filtre de region est fourni. Sans filtre,
 * 40 sitemaps suffisent a couvrir un catalogue. Avec filtre, le travail est
 * deja borne par la region : ASUS publie 11 619 sous-sitemaps, dont 166 pour
 * le Canada — s'arreter a 40 laisserait les trois quarts de ses fiches
 * canadiennes de cote.
 */
const MAX_SITEMAPS = 40;
const MAX_SITEMAPS_FILTRE = 220;

/** L'index est reconstruit passé ce délai. Un catalogue bouge lentement. */
const INDEX_TTL_DAYS = 14;

/**
 * Pages a ne PAS indexer.
 *
 * Un fabricant publie, pour un meme modele, une fiche produit ET une page de
 * support. Les deux portent la reference, mais seule la premiere affiche un
 * prix.
 *
 * Pire : l'adresse d'une page de support EST le numero de modele
 * (« /support/model/QN65QN90DAFXZC/ »), tandis que celle de la fiche produit
 * l'entoure de mots descriptifs. Le rapprochement retenant la correspondance la
 * plus courte — la plus precise, en general — la page de support gagnait
 * systematiquement. Mesure chez Samsung : 10 347 des 14 206 URL indexees, soit
 * 73 % de l'index, et AUCUN prix extrait.
 *
 * Meme chose pour les rubriques « business » : la fiche existe, la page se
 * charge, mais le tarif professionnel passe par un devis. Verifie sur
 * samsung.com/ca_fr/business/tvs/... — 539 Ko servis, aucun prix.
 */
const PAGES_SANS_PRIX =
  /\/(support|soutien|manual|manuel|driver|pilote|download|telecharg|faq|service|warranty|garantie|how-to|community|forum|register|repair|contact|business|entreprise|pro|b2b)(\/|$|-)/i;

/** Clé de rapprochement : « QN65QN80HAFXZC » et « qn65-qn80hafxzc » se rejoignent. */
export const modelKey = (model: string) => model.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Parcourt un sitemap, en descendant dans les index imbriqués.
 *
 * Renvoie les URL de pages, pas celles des sitemaps eux-mêmes.
 */
async function collectUrls(
  root: string,
  http: EnrichmentHttp,
  log: (m: string) => void,
  garder?: RegExp,
): Promise<string[]> {
  const vus = new Set<string>();
  const aVisiter = [{ url: root, depth: 0 }];
  const pages: string[] = [];
  const plafond = garder ? MAX_SITEMAPS_FILTRE : MAX_SITEMAPS;

  while (aVisiter.length > 0 && vus.size < plafond) {
    const { url, depth } = aVisiter.shift()!;
    if (vus.has(url)) continue;
    vus.add(url);

    let xml: string;
    try {
      xml = await http.getText(url);
    } catch {
      continue; // un sitemap absent ne doit pas interrompre les autres
    }

    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    // Un <sitemapindex> renvoie vers d'autres sitemaps ; un <urlset> vers des
    // pages. On distingue par la racine du document plutôt que par l'extension,
    // certains sites servant des index sous un nom de fichier quelconque.
    const estIndex = /<sitemapindex/i.test(xml);

    if (estIndex && depth < MAX_DEPTH) {
      // Les sous-sitemaps qui portent la region visee passent EN PREMIER.
      //
      // Sans ce tri, ASUS indexait ses pages africaines : son index est trie
      // alphabetiquement, « africa-fr » vient avant « ca-en », et le plafond de
      // MAX_SITEMAPS etait atteint bien avant d'arriver au Canada. Les fiches
      // ramenees n'affichaient alors aucun prix canadien.
      const tries = garder
        ? [...locs].sort((a, b) => Number(garder.test(b)) - Number(garder.test(a)))
        : locs;
      for (const l of tries) aVisiter.push({ url: l, depth: depth + 1 });
      log(`    ${locs.length} sous-sitemap(s) dans ${url.split('/').pop()}`);
    } else {
      pages.push(...(garder ? locs.filter((l) => garder.test(l)) : locs));
    }
  }

  return pages;
}

export interface IndexResult {
  brand: string;
  urls: number;
  indexed: number;
}

/**
 * Construit (ou reconstruit) l'index modèle → URL d'un fabricant.
 *
 * On n'indexe que les URL dont le dernier segment ressemble à une fiche
 * produit contenant une référence : les pages de catégorie ou d'assistance
 * n'apportent aucun prix.
 */
export async function buildSitemapIndex(
  brand: string,
  sitemapUrl: string,
  http: EnrichmentHttp,
  log: (m: string) => void = () => {},
  urlFilter?: string,
): Promise<IndexResult> {
  const conn = db();

  const garder = urlFilter ? new RegExp(urlFilter, 'i') : undefined;
  log(`  ${brand} : lecture de ${sitemapUrl}${garder ? ` (filtre ${urlFilter})` : ''}`);
  const urls = await collectUrls(sitemapUrl, http, log, garder);

  const insert = conn.prepare(
    `INSERT INTO manufacturer_urls (brand, model_key, url, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(brand, model_key) DO UPDATE SET
       url = excluded.url, fetched_at = excluded.fetched_at`,
  );

  const ts = nowIso();
  let indexed = 0;

  conn.transaction(() => {
    conn.prepare('DELETE FROM manufacturer_urls WHERE brand = ?').run(brand);

    for (const url of urls) {
      // Une page d'assistance porte la reference mais ne vend rien.
      if (PAGES_SANS_PRIX.test(url)) continue;

      // Le dernier segment porte le slug de la fiche, modèle compris.
      const segment = url.replace(/\/+$/, '').split('/').pop() ?? '';
      const cle = modelKey(segment);
      // Un slug trop court ne peut pas contenir de référence exploitable.
      if (cle.length < 8) continue;
      insert.run(brand, cle, url, ts);
      indexed++;
    }
  })();

  log(`  ${brand} : ${urls.length} URL lues, ${indexed} indexées`);
  return { brand, urls: urls.length, indexed };
}

/**
 * Retrouve l'URL de la fiche d'un modèle.
 *
 * Le rapprochement se fait par INCLUSION : les slugs des fabricants entourent
 * la référence de mots descriptifs (« s90h-77-inch-4k-smart-tv-qn77s90haexzc »),
 * donc une égalité stricte ne trouverait jamais rien.
 */
export function findManufacturerUrl(brand: string, model: string): string | null {
  const cle = modelKey(model);
  if (cle.length < 6) return null;

  const r = db()
    .prepare<[string, string], { url: string }>(
      `SELECT url FROM manufacturer_urls
        WHERE brand = ? AND instr(model_key, ?) > 0
        ORDER BY LENGTH(model_key) ASC LIMIT 1`,
    )
    .get(brand, cle);

  return r?.url ?? null;
}

/** L'index de cette marque est-il absent ou périmé ? */
export function indexIsStale(brand: string): boolean {
  const r = db()
    .prepare<[string], { fetched_at: string | null }>(
      'SELECT MAX(fetched_at) AS fetched_at FROM manufacturer_urls WHERE brand = ?',
    )
    .get(brand);

  if (!r?.fetched_at) return true;
  const age = Date.now() - Date.parse(r.fetched_at);
  return age > INDEX_TTL_DAYS * 86_400_000;
}
