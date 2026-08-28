import { db } from './index';

/**
 * Couche d'accès aux données du site.
 *
 * Toutes les pages lisent la base déjà calculée : aucune agrégation lourde au
 * moment du rendu, aucune requête réseau. C'est tout l'intérêt du modèle
 * « crawl par lots » — l'affichage est instantané parce que le travail a été
 * fait en amont.
 */

export interface DealRow {
  id: number;
  title: string;
  brand: string | null;
  model: string | null;
  url: string;
  imageUrl: string | null;
  description: string | null;
  storeId: string;
  storeName: string;
  storeColor: string | null;
  categorySlug: string | null;
  condition: string;
  currency: string;
  price: number;
  listPrice: number | null;
  inStock: number | null;
  rating: number | null;
  ratingCount: number | null;
  score: number;
  confidence: number;
  dropVsMedian: number | null;
  isLowestEver: number;
  median: number | null;
  minEver: number | null;
  maxEver: number | null;
  daysOfHistory: number;
  reasons: string[];
  recommendYes: number | null;
  recommendTotal: number | null;
}

const SELECT_DEAL = `
  SELECT p.id, p.title, p.brand, p.model, p.url, p.image_url AS imageUrl,
         p.description,
         p.store_id AS storeId, st.name AS storeName, st.color AS storeColor,
         p.category_slug AS categorySlug, p.condition, p.currency,
         p.current_price AS price, p.list_price AS listPrice, p.in_stock AS inStock,
         p.rating, p.rating_count AS ratingCount,
         s.score, s.confidence, s.drop_vs_median AS dropVsMedian,
         s.is_lowest_ever AS isLowestEver, s.median_90d AS median,
         s.min_ever AS minEver, s.max_ever AS maxEver,
         s.days_of_history AS daysOfHistory, s.reasons,
         e.recommend_yes AS recommendYes, e.recommend_total AS recommendTotal
    FROM deal_scores s
    JOIN products p ON p.id = s.product_id
    JOIN stores   st ON st.id = p.store_id
    LEFT JOIN product_enrichment e ON e.product_id = p.id
`;

function hydrate(r: any): DealRow {
  return { ...r, reasons: safeParse(r.reasons) };
}

function safeParse(json: string | null): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export interface DealFilters {
  category?: string;
  store?: string;
  /**
   * 'new'  (défaut) : neuf uniquement
   * 'all'           : tous les états
   * 'used'          : UNIQUEMENT boîte ouverte et remis à neuf
   *
   * La valeur 'used' existe parce que filtrer APRÈS la requête ne marche pas :
   * demander les 10 meilleurs puis ne garder que les non-neufs laisse une liste
   * vide, les meilleurs scores étant presque toujours des articles neufs. Le
   * filtre doit vivre dans le SQL.
   */
  condition?: 'new' | 'all' | 'used';
  minScore?: number;
  minConfidence?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  /** Ne garder que les produits au plus bas prix observe. */
  lowestEverOnly?: boolean;
  limit?: number;
  offset?: number;
  sort?: 'score' | 'drop' | 'price-asc' | 'price-desc';
}


/**
 * IMPORTANT — les filtres portent sur `deal_scores`, pas sur `products`.
 *
 * Les colonnes is_active / condition / category_slug / store_id / price y sont
 * recopiées à chaque calcul de score, précisément pour que le filtrage ET le
 * tri tiennent dans un seul index. Filtrer sur `products` obligeait SQLite à
 * joindre 163 000 lignes puis à tout trier en mémoire
 * (« USE TEMP B-TREE FOR ORDER BY »), soit 220-330 ms par requête.
 */
export function topDeals(f: DealFilters = {}): DealRow[] {
  const where: string[] = ['s.is_active = 1'];
  const params: Record<string, unknown> = {};

  if (f.category) {
    // On accepte une catégorie racine et on descend d'un niveau, pour que
    // « Électronique » remonte aussi les téléviseurs et les casques.
    where.push(`(s.category_slug = @category
                 OR s.category_slug IN (SELECT slug FROM categories WHERE parent_slug = @category))`);
    params.category = f.category;
  }
  if (f.store) {
    where.push('s.store_id = @store');
    params.store = f.store;
  }
  if (f.condition === 'used') where.push("s.condition != 'new'");
  else if (f.condition !== 'all') where.push("s.condition = 'new'");
  if (f.inStockOnly) where.push('(p.in_stock IS NULL OR p.in_stock = 1)');
  if (f.lowestEverOnly) where.push('s.is_lowest_ever = 1');
  if (f.minScore !== undefined) {
    where.push('s.score >= @minScore');
    params.minScore = f.minScore;
  }
  if (f.minConfidence !== undefined) {
    where.push('s.confidence >= @minConfidence');
    params.minConfidence = f.minConfidence;
  }
  if (f.maxPrice !== undefined) {
    where.push('s.price <= @maxPrice');
    params.maxPrice = f.maxPrice;
  }

  const order =
    f.sort === 'drop'
      ? 's.drop_vs_median DESC, s.score DESC'
      : f.sort === 'price-asc'
        ? 's.price ASC'
        : f.sort === 'price-desc'
          ? 's.price DESC'
          : 's.score DESC, s.confidence DESC';

  params.limit = f.limit ?? 48;
  params.offset = f.offset ?? 0;

  return db()
    .prepare(
      `${SELECT_DEAL} WHERE ${where.join(' AND ')}
       ORDER BY ${order} LIMIT @limit OFFSET @offset`,
    )
    .all(params)
    .map(hydrate);
}

export function countDeals(f: DealFilters = {}): number {
  const where: string[] = ['s.is_active = 1'];
  const params: Record<string, unknown> = {};
  if (f.category) {
    where.push(`(s.category_slug = @category
                 OR s.category_slug IN (SELECT slug FROM categories WHERE parent_slug = @category))`);
    params.category = f.category;
  }
  if (f.store) {
    where.push('s.store_id = @store');
    params.store = f.store;
  }
  if (f.condition === 'used') where.push("s.condition != 'new'");
  else if (f.condition !== 'all') where.push("s.condition = 'new'");
  if (f.minScore !== undefined) {
    where.push('s.score >= @minScore');
    params.minScore = f.minScore;
  }

  // Aucune jointure : tout est dans deal_scores, donc l'index suffit.
  return (
    db()
      .prepare(`SELECT COUNT(*) n FROM deal_scores s WHERE ${where.join(' AND ')}`)
      .get(params) as { n: number }
  ).n;
}

/**
 * Recherche plein texte.
 *
 * FTS5 fournit la pertinence (BM25), mais la pertinence seule renverrait le
 * produit le mieux nommé, pas la meilleure affaire. On combine donc les deux :
 * la pertinence filtre, le score de deal départage.
 */
export function search(
  query: string,
  f: DealFilters = {},
): { rows: DealRow[]; total: number } {
  const match = toFtsQuery(query);
  if (!match) return { rows: [], total: 0 };

  const where = ['s.is_active = 1'];
  const params: Record<string, unknown> = { match };

  if (f.category) {
    where.push(`(s.category_slug = @category
                 OR s.category_slug IN (SELECT slug FROM categories WHERE parent_slug = @category))`);
    params.category = f.category;
  }
  if (f.store) {
    where.push('s.store_id = @store');
    params.store = f.store;
  }
  if (f.condition === 'used') where.push("s.condition != 'new'");
  else if (f.condition !== 'all') where.push("s.condition = 'new'");
  if (f.maxPrice !== undefined) {
    where.push('s.price <= @maxPrice');
    params.maxPrice = f.maxPrice;
  }

  const order =
    f.sort === 'price-asc'
      ? 's.price ASC'
      : f.sort === 'price-desc'
        ? 's.price DESC'
        : f.sort === 'drop'
          ? 's.drop_vs_median DESC'
          : // Par défaut : pertinence d'abord (bm25 est négatif, plus bas = mieux),
            // puis qualité de l'affaire.
            'bm25(products_fts) * 1.0 + (100 - s.score) * 0.06 ASC';

  params.limit = f.limit ?? 48;
  params.offset = f.offset ?? 0;

  try {
    const rows = db()
      .prepare(
        `${SELECT_DEAL}
           JOIN products_fts fts ON fts.rowid = p.id
          WHERE products_fts MATCH @match AND ${where.join(' AND ')}
          ORDER BY ${order} LIMIT @limit OFFSET @offset`,
      )
      .all(params)
      .map(hydrate);

    const total = (
      db()
        .prepare(
          `SELECT COUNT(*) n FROM products_fts fts
             JOIN deal_scores s ON s.product_id = fts.rowid
            WHERE products_fts MATCH @match AND ${where.join(' AND ')}`,
        )
        .get(params) as { n: number }
    ).n;

    return { rows, total };
  } catch {
    // Une requête FTS malformée ne doit jamais casser la page.
    return { rows: [], total: 0 };
  }
}

/**
 * Transforme une saisie libre en requête FTS5 sûre.
 *
 * Sans ça, une apostrophe ou un guillemet suffirait à provoquer une erreur de
 * syntaxe FTS. On ne garde que des mots, et on ajoute `*` sur le dernier pour
 * que la recherche fonctionne pendant la frappe (« telev » trouve
 * « téléviseur »).
 */
export function toFtsQuery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 8);

  if (tokens.length === 0) return null;

  return tokens
    .map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`))
    .join(' AND ');
}

export function getProduct(id: number): DealRow | null {
  const row = db()
    .prepare(`${SELECT_DEAL} WHERE p.id = ?`)
    .get(id);
  return row ? hydrate(row) : null;
}

export interface HistoryPoint {
  price: number;
  listPrice: number | null;
  inStock: number | null;
  observedAt: string;
}

export function priceHistory(productId: number): HistoryPoint[] {
  return db()
    .prepare(
      `SELECT price, list_price AS listPrice, in_stock AS inStock, observed_at AS observedAt
         FROM price_points WHERE product_id = ? ORDER BY observed_at ASC`,
    )
    .all(productId) as HistoryPoint[];
}

/** Même modèle chez d'autres marchands — devient utile dès le 2e magasin. */
export function competingOffers(product: DealRow): DealRow[] {
  if (!product.model) return [];
  const key = product.model.toUpperCase().replace(/[-\s]/g, '');
  return db()
    .prepare(
      `${SELECT_DEAL}
        WHERE p.store_id != ? AND p.is_active = 1
          AND REPLACE(REPLACE(UPPER(p.model), '-', ''), ' ', '') = ?
        ORDER BY p.current_price ASC LIMIT 6`,
    )
    .all(product.storeId, key)
    .map(hydrate);
}

/**
 * Meilleurs produits du MÊME groupe de pairs, à qualité supérieure.
 *
 * Répond à la question que l'on se pose vraiment devant une fiche : « et si je
 * mettais un peu plus cher ? ». On reste dans le groupe de pairs plutôt que
 * dans la catégorie entière : proposer un téléviseur 85 po à quelqu'un qui
 * regarde un 43 po n'aide personne.
 */
export function betterAlternatives(product: DealRow, limit = 4): DealRow[] {
  const key = db()
    .prepare<[number], { peer_key: string | null; quality_score: number | null }>(
      'SELECT peer_key, quality_score FROM deal_scores WHERE product_id = ?',
    )
    .get(product.id);

  if (!key?.peer_key) return [];

  return db()
    .prepare(
      `${SELECT_DEAL}
        WHERE s.peer_key = @key
          AND s.is_active = 1
          AND s.product_id != @id
          AND s.quality_score > @quality
          AND s.price <= @maxPrice
        ORDER BY s.quality_score DESC, s.score DESC
        LIMIT @limit`,
    )
    .all({
      key: key.peer_key,
      id: product.id,
      quality: (key.quality_score ?? 0) + 0.05,
      // Au-delà du double du prix regardé, ce n'est plus une alternative.
      maxPrice: product.price * 2,
      limit,
    })
    .map(hydrate);
}


export interface Suggestion {
  /** Texte affiché, et inséré dans la barre pour les suggestions textuelles. */
  value: string;
  /** Nature de la suggestion, pour l'affichage. */
  kind: 'marque' | 'categorie' | 'produit';
  /** Contexte affiché à droite (nombre de produits, catégorie…). */
  hint?: string;
  /**
   * Destination directe, quand la suggestion désigne une chose précise.
   *
   * Sans cela, cliquer sur un produit relançait une RECHERCHE sur son titre
   * tronqué — qui, avec ses points de suspension, ne trouvait rien du tout.
   * Proposer un choix qui mène à une page vide est pire que ne rien proposer.
   */
  href?: string;
}

/**
 * Suggestions de recherche à la frappe.
 *
 * Trois natures, dans cet ordre de priorité — le même choix que fait un moteur
 * de recherche : d'abord les ENTITÉS (une marque, un rayon), qui mènent à un
 * ensemble cohérent de résultats ; ensuite les produits précis.
 *
 * On complète le dernier mot par un préfixe (`"telev"*` trouve « téléviseur »),
 * ce qui permet de proposer quelque chose dès la troisième lettre, avant même
 * que le mot soit fini.
 */
/**
 * Listes de marques et de catégories, gardées en mémoire.
 *
 * Elles ne changent qu'après un crawl, mais les recalculer coûtait un
 * `GROUP BY` sur 202 000 lignes À CHAQUE FRAPPE — soit 200 ms par appel, la
 * cause principale du manque de réactivité de la barre de recherche.
 *
 * Le cache expire après quelques minutes : assez pour absorber une session de
 * frappe entière, assez court pour qu'un nouveau crawl se voie rapidement.
 */
const CACHE_TTL_MS = 5 * 60_000;

let facetCache: {
  expires: number;
  brands: Array<{ name: string; norm: string; n: number }>;
  categories: Array<{ name: string; slug: string; words: string[]; n: number }>;
} | null = null;

const stripAccents = (x: string) =>
  x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function facets() {
  if (facetCache && facetCache.expires > Date.now()) return facetCache;
  const conn = db();

  const brands = conn
    .prepare<[], { brand: string; n: number }>(
      `SELECT p.brand, COUNT(*) n
         FROM products p
        WHERE p.is_active = 1 AND p.brand IS NOT NULL
        GROUP BY LOWER(p.brand) ORDER BY n DESC`,
    )
    .all()
    .map((b) => ({ name: b.brand, norm: stripAccents(b.brand), n: b.n }));

  const categories = conn
    .prepare<[], { name: string; slug: string; n: number }>(
      `SELECT c.name, c.slug, COUNT(s.product_id) n
         FROM categories c
         JOIN deal_scores s ON s.category_slug = c.slug AND s.is_active = 1
        GROUP BY c.slug ORDER BY n DESC`,
    )
    .all()
    .map((c) => ({
      name: c.name,
      slug: c.slug,
      words: stripAccents(c.name).split(/[^a-z0-9]+/).filter(Boolean),
      n: c.n,
    }));

  facetCache = { expires: Date.now() + CACHE_TTL_MS, brands, categories };
  return facetCache;
}

export function suggest(raw: string, limit = 4): Suggestion[] {
  const query = raw.trim().toLowerCase();
  if (query.length < 2) return [];

  const conn = db();
  const out: Suggestion[] = [];
  const seen = new Set<string>();

  /**
   * Deux titres marchands qui commencent pareil décrivent presque toujours des
   * déclinaisons du même produit. Proposer « Casque Bluetooth à suppression du
   * bruit… » trois fois de suite n'aide personne : on déduplique donc sur le
   * DÉBUT du libellé, pas sur son texte complet.
   */
  const dedupeKey = (v: string) =>
    v
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]/g, '')
      .slice(0, 34);

  const add = (s: Suggestion) => {
    const key = dedupeKey(s.value);
    if (seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push(s);
  };

  // L'appariement se fait en JavaScript, pas en SQL : le LIKE de SQLite
  // n'ignore pas les accents, donc « telev » ne trouvait jamais « Téléviseurs ».
  // Les volumes concernés (94 catégories, quelques milliers de marques) rendent
  // le filtrage en mémoire immédiat, là où le corriger en SQL demanderait une
  // colonne normalisée supplémentaire.
  const needle = stripAccents(query);

  // 1. Marques — la suggestion la plus utile : elle mène à un ensemble entier.
  for (const b of facets().brands.filter((x) => x.norm.startsWith(needle)).slice(0, 2)) {
    add({ value: b.name, kind: 'marque', hint: `${b.n} produits` });
  }

  // 2. Catégories dont un MOT commence par la saisie.
  //
  // Avec une correspondance « n'importe où dans le texte », taper « air »
  // proposait « Luminaires » : le mot contient bien ces trois lettres, mais
  // personne ne cherche ça.
  for (const c of facets()
    .categories.filter((x) => x.words.some((w) => w.startsWith(needle)))
    .slice(0, 1)) {
    add({
      value: c.name,
      kind: 'categorie',
      hint: `${c.n} produits`,
      href: `/categories/${c.slug}`,
    });
  }

  // 3. Produits — on complète le dernier mot, pour suggérer pendant la frappe.
  const candidats: Array<{ rang: number; suggestion: Suggestion }> = [];
  const match = toFtsQuery(query);
  if (match) {
    try {
      for (const p of conn
        .prepare<
          [string, number],
          {
            id: number;
            title: string;
            brand: string | null;
            model: string | null;
            category: string | null;
          }
        >(
          `SELECT p.id, p.title, p.brand, p.model, c.name AS category
             FROM products_fts fts
             JOIN deal_scores s ON s.product_id = fts.rowid AND s.is_active = 1
             JOIN products p ON p.id = fts.rowid
             LEFT JOIN categories c ON c.slug = s.category_slug
            WHERE products_fts MATCH ?
            -- PERTINENCE d'abord, pas score de deal.
            --
            -- Trier le vivier par score de bonne affaire laissait les 167
            -- AirPods du catalogue hors des 100 premiers résultats : ils
            -- n'atteignaient jamais l'étape de classement. Pour une
            -- autocomplétion, ce qui compte est la proximité au texte tapé ;
            -- la qualité de l'affaire départage ensuite.
            ORDER BY bm25(products_fts) ASC LIMIT ?`,
        )
        .all(match, limit * 25)) {
        // Les titres marchands sont longs ; on garde la tête, qui porte le sens.
        // Le libellé doit DISTINGUER, pas décrire.
        //
        // Les titres marchands commencent tous pareil : chercher « aw3225 »
        // renvoyait huit lignes « Boîte ouverte - Moniteur de jeu… », visuellement
        // identiques et sans rapport apparent avec la saisie. Quand on connaît la
        // marque et le modèle, on les met en tête : c'est ce qui identifie
        // réellement l'article.
        const identite = [p.brand, p.model].filter(Boolean).join(' ');
        const reste = p.title.length > 44 ? `${p.title.slice(0, 44).trimEnd()}…` : p.title;
        const libelle = identite ? `${identite} — ${reste}` : reste;

        // CLASSEMENT — le cœur d'une bonne autocomplétion.
        //
        // Taper « air » et obtenir « friteuse à air », c'est un mot qui ÉGALE
        // la saisie. Obtenir « AirPods », c'est un mot que la saisie COMPLÈTE.
        // Une autocomplétion prolonge ce qu'on écrit ; elle ne répète pas un
        // mot entier. On classe donc :
        //
        //   0 — la saisie ouvre le libellé (« Samsung… » pour « sams »)
        //   1 — la saisie allonge un mot ailleurs (« AirPods » pour « air »)
        //   2 — la saisie égale un mot entier (« à air » pour « air »)
        //
        // Sans cette distinction, les 167 AirPods du catalogue restaient
        // invisibles derrière des friteuses.
        const cible = stripAccents(`${identite} ${p.title}`);
        const mots = cible.split(/[^a-z0-9]+/).filter(Boolean);

        const rang = cible.startsWith(needle)
          ? 0
          : mots.some((m) => m.startsWith(needle) && m.length > needle.length)
            ? 1
            : 2;

        candidats.push({
          rang,
          suggestion: {
            value: libelle,
            kind: 'produit' as const,
            hint: p.category ?? undefined,
            href: `/produit/${p.id}`,
          },
        });
      }
    } catch {
      // Une requête FTS malformée ne doit jamais casser la saisie.
    }
  }

  // Les correspondances en début de libellé d'abord, l'ordre de pertinence
  // FTS ensuite — un tri stable préserve ce second critère.
  for (const c of candidats.sort((a, b) => a.rang - b.rang)) add(c.suggestion);

  return out;
}


export interface CategoryRank {
  /** Rang du produit dans sa catégorie, 1 = meilleur score. */
  rank: number;
  /** Nombre de produits classés dans cette catégorie. */
  total: number;
  categoryName: string;
  /** Les mieux classés de la catégorie, pour situer le produit. */
  leaders: Array<{ id: number; title: string; price: number; score: number }>;
}

/**
 * Position du produit dans sa catégorie, et qui occupe la tête.
 *
 * Un score de 43 ne dit rien seul : est-ce bon ? Savoir qu'il est 12e sur 4 000
 * répond à la question, et voir les trois premiers permet de juger si l'écart
 * vaut la différence de prix.
 *
 * Quand le produit fait DÉJÀ partie des trois premiers, on montre les autres
 * membres du podium plutôt que de le lister lui-même — se voir proposer ce
 * qu'on regarde déjà n'apprend rien.
 */
export function categoryRank(product: DealRow): CategoryRank | null {
  if (!product.categorySlug) return null;
  const conn = db();

  const meilleurs = conn
    .prepare<[string, number], { n: number }>(
      `SELECT COUNT(*) n FROM deal_scores
        WHERE is_active = 1 AND category_slug = ? AND score > ?`,
    )
    .get(product.categorySlug, product.score)!.n;

  const total = conn
    .prepare<[string], { n: number }>(
      'SELECT COUNT(*) n FROM deal_scores WHERE is_active = 1 AND category_slug = ?',
    )
    .get(product.categorySlug)!.n;

  if (total < 5) return null;

  const leaders = conn
    .prepare<[string, number], { id: number; title: string; price: number; score: number }>(
      `SELECT s.product_id AS id, p.title, s.price, s.score
         FROM deal_scores s JOIN products p ON p.id = s.product_id
        WHERE s.is_active = 1 AND s.category_slug = ? AND s.product_id != ?
        ORDER BY s.score DESC LIMIT 3`,
    )
    .all(product.categorySlug, product.id);

  return {
    rank: meilleurs + 1,
    total,
    categoryName: categoryNameOf(product.categorySlug),
    leaders,
  };
}

function categoryNameOf(slug: string): string {
  const r = db()
    .prepare<[string], { name: string }>('SELECT name FROM categories WHERE slug = ?')
    .get(slug);
  return r?.name ?? slug;
}

/**
 * Produits vraiment comparables, pour un face-à-face.
 *
 * On reste dans le MÊME groupe de pairs — même format, mêmes caractéristiques
 * déterminantes — et on retient les plus proches en prix. Proposer un modèle
 * deux fois plus cher ne permet pas de juger un rapport qualité-prix ; le
 * comparer à des articles de sa gamme, si.
 */
export function comparables(product: DealRow, limit = 3): DealRow[] {
  const key = db()
    .prepare<[number], { peer_key: string | null }>(
      'SELECT peer_key FROM deal_scores WHERE product_id = ?',
    )
    .get(product.id);

  if (!key?.peer_key) return [];

  return db()
    .prepare(
      `${SELECT_DEAL}
        WHERE s.peer_key = @key
          AND s.is_active = 1
          AND s.product_id != @id
        ORDER BY ABS(s.price - @price) ASC
        LIMIT @limit`,
    )
    .all({ key: key.peer_key, id: product.id, price: product.price, limit })
    .map(hydrate);
}

export interface CategoryCount {
  slug: string;
  name: string;
  parentSlug: string | null;
  icon: string | null;
  count: number;
  bestScore: number | null;
}

/**
 * Catégories effectivement peuplées, avec leur volume et leur meilleur deal.
 *
 * L'agrégation se fait sur `deal_scores` seul, via l'index de catégorie. Une
 * version antérieure joignait `products` puis `deal_scores` avant de grouper —
 * correct, mais 110 ms sur un catalogue de 200 000 lignes, payés sur deux pages
 * du site.
 */
export function categoriesWithCounts(): CategoryCount[] {
  return db()
    .prepare(
      `WITH totaux AS (
         SELECT category_slug AS slug,
                COUNT(*)      AS count,
                MAX(score)    AS bestScore
           FROM deal_scores
          WHERE is_active = 1 AND category_slug IS NOT NULL
          GROUP BY category_slug
       )
       SELECT c.slug, c.name, c.parent_slug AS parentSlug, c.icon,
              COALESCE(t.count, 0)              AS count,
              ROUND(t.bestScore, 1)             AS bestScore
         FROM categories c
         LEFT JOIN totaux t ON t.slug = c.slug
        ORDER BY c.sort_order`,
    )
    .all() as CategoryCount[];
}

export interface SiteStats {
  products: number;
  stores: number;
  pricePoints: number;
  lastCrawl: string | null;
  lowestEver: number;
}

export function siteStats(): SiteStats {
  const c = db();
  // Les compteurs passent par deal_scores : ses colonnes dénormalisées sont
  // indexées, alors qu'un COUNT sur products impose un balayage complet.
  const p = c
    .prepare('SELECT COUNT(*) n FROM deal_scores WHERE is_active = 1')
    .get() as { n: number };
  const st = c
    .prepare('SELECT COUNT(DISTINCT store_id) n FROM deal_scores WHERE is_active = 1')
    .get() as { n: number };
  const pp = c.prepare('SELECT COUNT(*) n FROM price_points').get() as { n: number };
  const last = c
    .prepare("SELECT MAX(finished_at) t FROM crawl_runs WHERE status IN ('ok','partial')")
    .get() as { t: string | null };
  const low = c
    .prepare('SELECT COUNT(*) n FROM deal_scores WHERE is_active = 1 AND is_lowest_ever = 1')
    .get() as { n: number };

  return {
    products: p.n,
    stores: st.n,
    pricePoints: pp.n,
    lastCrawl: last.t,
    lowestEver: low.n,
  };
}

export function activeStores() {
  return db()
    .prepare(
      `SELECT st.id, st.name, st.color, st.homepage, st.enabled,
              COUNT(p.id) AS products
         FROM stores st
         LEFT JOIN products p ON p.store_id = st.id AND p.is_active = 1
        GROUP BY st.id ORDER BY products DESC, st.name`,
    )
    .all() as Array<{
    id: string;
    name: string;
    color: string | null;
    homepage: string;
    enabled: number;
    products: number;
  }>;
}
