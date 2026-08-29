import zlib from 'node:zlib';
import { HttpClient } from '../core/http';
import { db, nowIso } from '../../db';
import { CATEGORY_MAP } from './bestbuy';

/**
 * MOISSON DES MARQUES.
 *
 * ----------------------------------------------------------------------------
 * LE PROBLÈME
 * ----------------------------------------------------------------------------
 *
 * Le prix officiel du fabricant est l'ancre de référence la plus solide qui
 * existe. Y accéder demande deux informations : la MARQUE (pour savoir à qui
 * s'adresser) et le MODÈLE (pour savoir quoi demander).
 *
 * Le modèle, on l'extrait du titre — Best Buy le met entre parenthèses.
 * La marque, elle, n'apparaît nulle part dans le listing : mesurée à
 * 894 produits sur 279 603, soit 0,3 %. C'était le vrai goulot, et non la
 * découverte des fiches fabricant.
 *
 * ----------------------------------------------------------------------------
 * DEUX FAUSSES PISTES, MESURÉES
 * ----------------------------------------------------------------------------
 *
 *   - Deviner la marque depuis le titre. « Portable de 15,6 po Gateway d'Acer »
 *     contient DEUX noms de marque ; l'un est la gamme, l'autre le fabricant.
 *     Une heuristique se trompe, et une marque fausse envoie interroger le
 *     mauvais fabricant : pire que pas de marque du tout.
 *
 *   - Lire la fiche unitaire, qui expose bien `brandName`. Latence mesurée :
 *     9 s par fiche. Pour 280 000 produits, plus de 70 h même à dix requêtes
 *     en parallèle. Inexploitable.
 *
 * ----------------------------------------------------------------------------
 * LA SOLUTION : DÉCOUPER LE CATALOGUE PAR MARQUE AU LIEU DE PAR RAYON
 * ----------------------------------------------------------------------------
 *
 * L'API de recherche accepte `path=brandName:X`. Vérifié : `brandName:Samsung`
 * renvoie 1 483 produits, `brandName:on-stage` en renvoie 131.
 *
 * Et le marchand publie la liste de ses marques : une page `/fr-ca/marque/…`
 * par marque dans son sitemap.
 *
 * Le point clé : parcourir le catalogue tranché par marque coûte le MÊME nombre
 * de pages que le parcourir tranché par rayon — c'est le même catalogue. On
 * obtient donc la marque de chaque produit pour le prix d'une collecte, et la
 * valeur est celle du marchand lui-même, pas une supposition.
 */

const BASE = 'https://www.bestbuy.ca';
const PAGE_SIZE = 100;

/** Même plafond que le listing par rayon : au-delà, l'API renvoie du vide. */
const PAGE_CAP = 20;
const MAX_REACHABLE = PAGE_CAP * PAGE_SIZE; // 2 000

/** Au-delà, on relit les sitemaps : une enseigne ajoute des marques lentement. */
const SLUGS_TTL_DAYS = 30;

/** Tous les identifiants de rayon connus, pour redécouper les grosses marques. */
const ALL_CATEGORY_IDS = [...new Set(Object.values(CATEGORY_MAP).flat())];

interface SearchResponse {
  total: number;
  products: Array<{ sku: string }>;
}

const searchUrl = (facet: string, page: number, categoryId?: string) => {
  const p = new URLSearchParams({
    path: `brandName:${facet}`,
    page: String(page),
    pageSize: String(PAGE_SIZE),
    lang: 'fr-CA',
  });
  if (categoryId) p.set('categoryid', categoryId);
  return `${BASE}/api/v2/json/search?${p}`;
};

/**
 * Récupère la liste des marques depuis le sitemap du marchand.
 *
 * Les sitemaps sont gzippés et mélangent fiches produit, rayons et marques ;
 * on ne retient que les pages `/fr-ca/marque/<slug>`.
 */
export async function discoverBrandSlugs(
  http: HttpClient,
  log: (m: string) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  const index = await http.getText(`${BASE}/sitemap_index.xml`, {}, signal);
  const fichiers = [...index.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  log(`  ${fichiers.length} sitemaps à parcourir`);

  const slugs = new Set<string>();

  for (const [i, url] of fichiers.entries()) {
    let xml: string;
    try {
      const res = await http.raw(url, {}, signal);
      const buf = Buffer.from(await res.arrayBuffer());
      // Le fichier est gzippé en tant que tel. Selon que la couche HTTP a déjà
      // décompressé ou non, on reçoit l'un ou l'autre : on essaie, et à défaut
      // on lit les octets tels quels.
      try {
        xml = zlib.gunzipSync(buf).toString('utf8');
      } catch {
        xml = buf.toString('utf8');
      }
    } catch (err) {
      log(`  ⚠ ${url.split('/').pop()} illisible (${(err as Error).message})`);
      continue;
    }

    const avant = slugs.size;
    for (const m of xml.matchAll(
      /<loc>https:\/\/www\.bestbuy\.ca\/fr-ca\/marque\/([^<\s/]+)\s*<\/loc>/gi,
    )) {
      slugs.add(decodeURIComponent(m[1]).toLowerCase());
    }
    log(`  sitemap ${i + 1}/${fichiers.length} : +${slugs.size - avant} marques (${slugs.size})`);
  }

  return [...slugs].sort();
}

/**
 * Trouve la forme du nom qui fait RÉELLEMENT filtrer l'API.
 *
 * Le slug d'URL n'est pas toujours le nom de marque : « on-stage » garde son
 * tiret, d'autres marques s'écrivent avec une espace. On essaie les deux
 * formes et on garde celle qui renvoie des produits. Un total de zéro est une
 * réponse claire : ce n'est pas la bonne graphie.
 */
async function resolveFacet(
  http: HttpClient,
  slug: string,
  signal?: AbortSignal,
): Promise<{ facet: string; total: number } | null> {
  const candidats = slug.includes('-') ? [slug, slug.replace(/-/g, ' ')] : [slug];

  for (const facet of candidats) {
    try {
      const r = await http.getJson<SearchResponse>(searchUrl(facet, 1), {}, signal);
      if (r.total > 0) return { facet, total: r.total };
    } catch {
      // Une marque disparue du catalogue renvoie une erreur : on passe.
    }
  }
  return null;
}

/** Parcourt une requête paginée et accumule les SKU. */
async function collectSkus(
  http: HttpClient,
  facet: string,
  categoryId: string | undefined,
  out: Set<string>,
  signal?: AbortSignal,
): Promise<void> {
  for (let page = 1; page <= PAGE_CAP; page++) {
    const r = await http.getJson<SearchResponse>(searchUrl(facet, page, categoryId), {}, signal);
    if (!r.products?.length) break;
    for (const p of r.products) out.add(String(p.sku));
    if (page * PAGE_SIZE >= r.total) break;
  }
}

/**
 * Rassemble les SKU d'une marque.
 *
 * Au-delà de 2 000 produits, l'API refuse d'aller plus loin, exactement comme
 * pour les rayons. On redécoupe alors marque × rayon : chaque tranche repasse
 * sous le plafond.
 */
async function skusForBrand(
  http: HttpClient,
  facet: string,
  total: number,
  signal?: AbortSignal,
): Promise<Set<string>> {
  const skus = new Set<string>();
  await collectSkus(http, facet, undefined, skus, signal);

  if (total > MAX_REACHABLE) {
    for (const cat of ALL_CATEGORY_IDS) {
      try {
        await collectSkus(http, facet, cat, skus, signal);
      } catch {
        // Un rayon vide pour cette marque n'a rien d'anormal.
      }
    }
  }

  return skus;
}

/**
 * Mots qui ouvrent souvent un titre sans jamais designer une marque.
 * Les laisser passer ne fausserait rien — le marchand repondrait zero — mais
 * chacun coute une requete inutile.
 */
const NON_MARQUES = new Set([
  'boite', 'ouverte', 'open', 'box', 'remis', 'neuf', 'nouveau', 'nouvelle', 'new',
  'ensemble', 'lot', 'paquet', 'trousse', 'kit', 'pack', 'le', 'la', 'les', 'un',
  'une', 'des', 'du', 'de', 'et', 'ou', 'avec', 'sans', 'pour', 'plus', 'mini',
  'jeu', 'jeux', 'housse', 'etui', 'cable', 'chargeur', 'adaptateur', 'support',
  'coque', 'protecteur', 'sac', 'table', 'chaise', 'lampe', 'grand', 'petit',
]);

/** Retire les accents pour comparer aux mots ci-dessus. */
const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * DEVINE des noms de marque a partir des titres non etiquetes.
 *
 * Le sitemap du marchand ne publie qu'une partie de ses marques (131 mesurees,
 * pour un catalogue de plus de 270 000 produits). Le reste doit etre devine.
 *
 * Deviner serait dangereux si nous decidions nous-memes du resultat. Ce n'est
 * pas le cas : chaque candidat est SOUMIS au marchand via son filtre
 * `brandName`, qui est exact — verifie, « gaming », « portable », « noir » et
 * « samsung galaxy » renvoient tous zero. Une mauvaise devinette coute une
 * requete et n'etiquette rien. L'autorite reste entierement au marchand.
 *
 * Les titres francais de Best Buy placent la marque apres « de » ou « d' »
 * (« Portable de 14 po Vivobook d'ASUS »), et parfois en tete de titre.
 */
export function mineBrandCandidates(storeId: string, limit = 1500): string[] {
  const titres = db()
    .prepare<[string], { title: string }>(
      `SELECT title FROM products
        WHERE store_id = ? AND is_active = 1 AND (brand IS NULL OR brand = '')`,
    )
    .all(storeId);

  const freq = new Map<string, number>();
  const ajoute = (brut: string | undefined) => {
    if (!brut) return;
    const c = brut.trim().replace(/[.,;:–-]+$/, '');
    if (c.length < 2 || c.length > 24) return;
    const cle = sansAccents(c).toLowerCase();
    if (NON_MARQUES.has(cle)) return;
    // Un candidat purement numerique n'est jamais une marque.
    if (!/[a-z]/i.test(sansAccents(c))) return;
    freq.set(c.toLowerCase(), (freq.get(c.toLowerCase()) ?? 0) + 1);
  };

  const MOT = "[A-ZÀ-Ü][A-Za-z0-9À-ÿ&.+'’-]*";
  const apresDe = new RegExp(`\bd(?:e\s|['’])(${MOT})`, 'g');
  const enTete = new RegExp(`^(${MOT})`);

  for (const { title } of titres) {
    for (const m of title.matchAll(apresDe)) ajoute(m[1]);
    ajoute(title.match(enTete)?.[1]);
  }

  // Un nom vu une seule fois est presque toujours un mot du titre, pas une
  // marque. Le seuil evite de depenser des milliers de requetes pour rien.
  return [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([c]) => c);
}

export interface HarvestResult {
  brands: number;
  resolved: number;
  labelled: number;
}

/**
 * Passe complète : découverte des marques puis étiquetage des produits.
 *
 * On écrit marque par marque plutôt qu'à la fin : une interruption laisse
 * alors un résultat partiel exploitable, pas une heure de travail perdue.
 */
export async function harvestBrands(
  storeId: string,
  http: HttpClient,
  log: (m: string) => void,
  opts: { signal?: AbortSignal; only?: number; rediscover?: boolean; mine?: boolean } = {},
): Promise<HarvestResult> {
  const conn = db();
  const { signal } = opts;

  // La liste des marques est stable et coûte 38 sitemaps gzippés à découvrir.
  // On la relit donc en base tant qu'elle n'a pas vieilli : une passe suivante
  // ne repaie que l'étiquetage, qui est le travail utile.
  const connus = conn
    .prepare<[string, string], { slug: string }>(
      `SELECT slug FROM store_brands
        WHERE store_id = ? AND checked_at > ? AND facet IS NOT NULL
        ORDER BY slug`,
    )
    .all(storeId, new Date(Date.now() - SLUGS_TTL_DAYS * 86_400_000).toISOString())
    .map((r) => r.slug);

  let slugs: string[];
  if (connus.length > 0 && !opts.rediscover) {
    slugs = connus;
    log(`${slugs.length} marques déjà connues (--rediscover pour relire les sitemaps).`);
  } else {
    log('Découverte des marques via le sitemap…');
    slugs = await discoverBrandSlugs(http, log, signal);
    log(`${slugs.length} marques trouvées.`);
  }
  if (opts.only) slugs = slugs.slice(0, opts.only);

  const majBrand = conn.prepare<[string, string, string]>(
    `UPDATE products SET brand = ? WHERE store_id = ? AND store_sku = ?`,
  );
  const majMarque = conn.prepare<[string, string, string | null, number, number, string]>(
    `INSERT INTO store_brands (store_id, slug, facet, product_count, labelled, checked_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(store_id, slug) DO UPDATE SET
       facet = excluded.facet, product_count = excluded.product_count,
       labelled = excluded.labelled, checked_at = excluded.checked_at`,
  );

  let resolved = 0;
  let labelled = 0;

  /** Soumet une liste de noms au marchand et etiquette ce qu'il reconnait. */
  const traiter = async (noms: string[], phase: string) => {
    for (const [i, nom] of noms.entries()) {
      if (signal?.aborted) break;

      const trouve = await resolveFacet(http, nom, signal);
      const ts = nowIso();

      if (!trouve) {
        majMarque.run(storeId, nom, null, 0, 0, ts);
        continue;
      }
      resolved++;

      const skus = await skusForBrand(http, trouve.facet, trouve.total, signal);

      // La marque est écrite en minuscules : c'est la forme sur laquelle se font
      // tous les rapprochements (sites fabricants, groupes de pairs). L'affichage
      // peut la remettre en forme ; la comparaison ne doit jamais dépendre de la
      // casse retournée par un marchand.
      const marque = trouve.facet.toLowerCase();
      const n = conn.transaction(() => {
        let touches = 0;
        for (const sku of skus) touches += majBrand.run(marque, storeId, sku).changes;
        return touches;
      })();

      labelled += n;
      majMarque.run(storeId, nom, trouve.facet, trouve.total, n, ts);

      if ((i + 1) % 25 === 0 || n > 500) {
        log(
          `  ${phase} [${i + 1}/${noms.length}] ${nom} : ${trouve.total} annoncés,` +
            ` ${n} étiquetés — cumul ${labelled}`,
        );
      }
    }
  };

  await traiter(slugs, 'sitemap');

  // Seconde passe : ce que le sitemap ne publie pas, on le devine depuis les
  // titres restes sans marque, et on le fait valider par le marchand.
  let devines: string[] = [];
  if (opts.mine !== false && !signal?.aborted) {
    const dejaVus = new Set(slugs.map((s) => s.toLowerCase()));
    devines = mineBrandCandidates(storeId).filter((c) => !dejaVus.has(c));
    log(`
${devines.length} noms candidats extraits des titres sans marque.`);
    await traiter(devines, 'titres');
  }

  return { brands: slugs.length + devines.length, resolved, labelled };
}
