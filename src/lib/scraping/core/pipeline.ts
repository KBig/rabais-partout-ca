import { db, nowIso } from '../../db/index';
import { getStore } from '../registry';
import { HttpClient } from './http';
import type { CrawlContext, CrawlStrategy, RawProduct } from '../types';

/**
 * Moteur d'ingestion : prend le flux de produits d'un adaptateur et le
 * transforme en état + historique en base.
 *
 * LE point délicat, c'est l'écriture de l'historique. On n'insère un
 * price_point QUE si le prix a réellement bougé. Conséquence : chaque ligne
 * d'historique représente un INTERVALLE de temps, pas un instant. Toute la
 * statistique en aval (pricing/stats.ts) doit en tenir compte.
 */

export interface CrawlOptions {
  storeId: string;
  strategy: CrawlStrategy;
  target?: string;
  maxPages?: number;
  maxProducts?: number;
  signal?: AbortSignal;
  log?: (msg: string) => void;
}

export interface CrawlResult {
  runId: number;
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  seen: number;
  created: number;
  priceChanges: number;
  requests: number;
  error?: string;
}

const FLUSH_EVERY = 400;

/** Deux prix sont « identiques » à un cent près (évite le bruit des flottants). */
const samePrice = (a: number | null, b: number | null) =>
  a === null && b === null ? true : a === null || b === null ? false : Math.abs(a - b) < 0.005;

/**
 * Au-delà de ce rapport, un « prix régulier » n'est plus un rabais profond :
 * c'est une donnée invalide.
 *
 * Constaté en base après un crawl complet : une cartouche d'encre à 29,03 $
 * affichée « régulier 1 400 $ » (48x), un ustensile à 5,99 $ contre 199,99 $
 * (33x). Ce sont des erreurs de saisie de vendeurs tiers, pas des soldes.
 * 15 produits dépassaient 10x, 80 dépassaient 5x.
 *
 * Le seuil de 6x correspond à un rabais annoncé de ~83 %. Les vraies
 * liquidations descendent rarement plus bas, et au-delà le chiffre décrédibilise
 * l'affichage plus qu'il n'informe.
 */
const MAX_PLAUSIBLE_LIST_RATIO = 6;

/**
 * Normalise une évaluation absente.
 *
 * Les marchands renvoient `0` — et non `null` — pour un produit sans avis.
 * Laisser ce zéro entrer en base le rendait indiscernable d'une vraie note
 * catastrophique : un opérateur `??` le prenait pour une valeur, et un article
 * héritant de 322 avis s'affichait « 0,0 sur 5 ».
 *
 * On corrige donc à la SOURCE, une seule fois, plutôt que de se souvenir de
 * tester `> 0` à chaque lecture. Tout magasin ajouté ensuite en bénéficie.
 */
/**
 * Nettoie un descriptif marchand.
 *
 * Les marchands renvoient du HTML dans leurs champs texte :
 * « <p><strong>Produit boite ouverte certifie…</strong></p>Profitez d'une… ».
 * Affiche tel quel, on voyait les balises a l'ecran.
 *
 * On ne rend PAS ce HTML : le contenu vient d'un tiers, et l'injecter dans la
 * page ouvrirait la porte a du balisage arbitraire. On le convertit donc en
 * texte, en preservant les separations de blocs pour que les phrases ne se
 * collent pas les unes aux autres.
 */
function cleanDescription(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const texte = raw
    // Les fins de bloc deviennent des espaces : sans cela « …ci-dessous.</p>
    // <p>Profitez… » donnerait « ci-dessous.Profitez ».
    .replace(/<\/(p|div|li|br|h[1-6])\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    // Entites HTML les plus courantes dans les fiches produit.
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  return texte.length > 0 ? texte : null;
}

function normalizeRating(
  rating: number | null | undefined,
  count: number | null | undefined,
): { rating: number | null; count: number | null } {
  const c = typeof count === 'number' && count > 0 ? count : null;
  const r = typeof rating === 'number' && rating > 0 && c !== null ? rating : null;
  return { rating: r, count: c };
}

/**
 * Retient le prix régulier du marchand seulement s'il est crédible.
 *
 * Le filtre vit ici, dans le pipeline, et non dans un adaptateur : tout magasin
 * ajouté par la suite en bénéficie sans avoir à y penser.
 */
function sanitizeListPrice(listPrice: number | null, price: number): number | null {
  if (listPrice === null || !(listPrice > price)) return null;
  if (listPrice > price * MAX_PLAUSIBLE_LIST_RATIO) return null;
  return listPrice;
}

export async function crawl(opts: CrawlOptions): Promise<CrawlResult> {
  const conn = db();
  const store = getStore(opts.storeId);
  const log = opts.log ?? (() => {});

  if (!store.adapter) {
    throw new Error(`Le magasin "${store.id}" n'a pas encore d'adaptateur.`);
  }

  // --- Disjoncteur : un magasin en échec répété est mis au repos ------------
  const health = conn
    .prepare('SELECT consecutive_failures, paused_until FROM stores WHERE id = ?')
    .get(store.id) as { consecutive_failures: number; paused_until: string | null } | undefined;

  if (health?.paused_until && health.paused_until > nowIso()) {
    log(`${store.name} est en pause jusqu'à ${health.paused_until} (échecs répétés).`);
    return { runId: -1, status: 'skipped', seen: 0, created: 0, priceChanges: 0, requests: 0 };
  }

  const runId = Number(
    conn
      .prepare(
        `INSERT INTO crawl_runs (store_id, strategy, target, status, started_at)
         VALUES (?, ?, ?, 'running', ?)`,
      )
      .run(store.id, opts.strategy, opts.target ?? null, nowIso()).lastInsertRowid,
  );

  const http = new HttpClient({ requestsPerSecond: store.requestsPerSecond });
  const controller = new AbortController();
  if (opts.signal) opts.signal.addEventListener('abort', () => controller.abort(), { once: true });

  const ctx: CrawlContext = {
    limits: {
      maxPages: opts.maxPages ?? 40,
      maxProducts: opts.maxProducts ?? 5000,
    },
    signal: controller.signal,
    log,
    getJson: (url, init) => http.getJson(url, init, controller.signal),
    getText: (url, init) => http.getText(url, init, controller.signal),
    requests: () => http.requestCount,
  };

  const stats = { seen: 0, created: 0, priceChanges: 0 };
  let buffer: RawProduct[] = [];
  let error: string | undefined;

  /**
   * Écrit le lot courant, en réessayant si la base est momentanément verrouillée.
   *
   * SQLite ne tolère qu'un écrivain à la fois. Si un calcul de score tourne en
   * parallèle, l'écriture attend — et au-delà du `busy_timeout` elle échoue.
   * Perdre toute une collecte pour un verrou de quelques secondes serait absurde :
   * on réessaie, en espaçant, et on n'abandonne qu'après plusieurs tentatives.
   */
  const flush = async () => {
    if (buffer.length === 0) return;
    const lot = buffer;
    buffer = [];

    for (let essai = 0; essai < 4; essai++) {
      try {
        ingestBatch(store.id, lot, stats);
        return;
      } catch (err) {
        const verrouille =
          err instanceof Error && /SQLITE_BUSY|database is locked/i.test(err.message);
        if (!verrouille || essai === 3) throw err;
        log(`  base verrouillée, nouvelle tentative dans ${(essai + 1) * 5} s…`);
        await new Promise((r) => setTimeout(r, (essai + 1) * 5000));
      }
    }
  };

  try {
    const source = pickSource(store.adapter, opts, ctx);

    for await (const product of source) {
      buffer.push(product);
      if (buffer.length >= FLUSH_EVERY) {
        await flush();
        log(`  … ${stats.seen} produits traités`);
      }
    }
    await flush();

    conn
      .prepare('UPDATE stores SET consecutive_failures = 0, paused_until = NULL WHERE id = ?')
      .run(store.id);
  } catch (err) {
    // On ne jette pas ce qui a déjà été récupéré. Si même cette écriture de
    // secours échoue, on garde l'erreur d'origine, plus informative.
    try {
      await flush();
    } catch {
      /* rien de plus à tenter ici */
    }
    error = err instanceof Error ? err.message : String(err);

    // Backoff exponentiel : 5 min, 10, 20, 40… plafonné à 6 h.
    const fails = (health?.consecutive_failures ?? 0) + 1;
    const pauseMin = Math.min(360, 5 * 2 ** (fails - 1));
    conn
      .prepare('UPDATE stores SET consecutive_failures = ?, paused_until = ? WHERE id = ?')
      .run(fails, new Date(Date.now() + pauseMin * 60_000).toISOString(), store.id);

    log(`Échec : ${error} — pause de ${pauseMin} min (échec #${fails}).`);
  }

  // « partial » = on a planté mais on a quand même ramené des données utiles.
  const status: CrawlResult['status'] = error ? (stats.seen > 0 ? 'partial' : 'failed') : 'ok';

  conn
    .prepare(
      `UPDATE crawl_runs
         SET status = ?, products_seen = ?, products_new = ?, price_changes = ?,
             requests_made = ?, error = ?, finished_at = ?
       WHERE id = ?`,
    )
    .run(status, stats.seen, stats.created, stats.priceChanges, http.requestCount, error ?? null, nowIso(), runId);

  return { runId, status, ...stats, requests: http.requestCount, error };
}

function pickSource(
  adapter: NonNullable<ReturnType<typeof getStore>['adapter']>,
  opts: CrawlOptions,
  ctx: CrawlContext,
): AsyncGenerator<RawProduct> {
  switch (opts.strategy) {
    case 'deals':
      if (!adapter.listDeals) throw new Error(`${adapter.id} ne sait pas lister les rabais.`);
      return adapter.listDeals(ctx);
    case 'category':
      if (!adapter.listCategory) throw new Error(`${adapter.id} ne sait pas parcourir un rayon.`);
      if (!opts.target) throw new Error('Stratégie "category" : il faut une catégorie cible.');
      return adapter.listCategory(opts.target, ctx);
    case 'search':
      if (!adapter.search) throw new Error(`${adapter.id} ne sait pas chercher.`);
      if (!opts.target) throw new Error('Stratégie "search" : il faut une requête.');
      return adapter.search(opts.target, ctx);
  }
}

interface ExistingRow {
  id: number;
  current_price: number | null;
  list_price: number | null;
  in_stock: number | null;
}

/**
 * Écrit un lot de produits en une seule transaction.
 *
 * Grouper les écritures est ce qui fait la différence entre ~500 produits/s et
 * ~50 : chaque transaction SQLite implique une synchro disque.
 */
function ingestBatch(
  storeId: string,
  batch: RawProduct[],
  stats: { seen: number; created: number; priceChanges: number },
): void {
  const conn = db();
  const ts = nowIso();

  const selectExisting = conn.prepare<[string, string], ExistingRow>(
    'SELECT id, current_price, list_price, in_stock FROM products WHERE store_id = ? AND store_sku = ?',
  );

  const insertProduct = conn.prepare(`
    INSERT INTO products (
      store_id, store_sku, url, title, brand, model, image_url,
      category_slug, store_category, rating, rating_count, condition, description,
      availability, marketplace, seller_name,
      currency, current_price, list_price, in_stock,
      first_seen_at, last_seen_at, last_price_change_at, is_active
    ) VALUES (
      @storeId, @sku, @url, @title, @brand, @model, @imageUrl,
      @categorySlug, @storeCategory, @rating, @ratingCount, @condition, @description,
      @availability, @marketplace, @sellerName,
      @currency, @price, @listPrice, @inStock,
      @ts, @ts, @ts, 1
    )
  `);

  // Le prix N'EST PAS mis à jour ici : il l'est seulement s'il a changé,
  // en même temps que l'insertion du price_point, pour rester cohérent.
  const touchProduct = conn.prepare(`
    UPDATE products SET
      url = @url, title = @title, image_url = @imageUrl,
      description = COALESCE(@description, description),
      model = COALESCE(@model, model),
      category_slug = COALESCE(@categorySlug, category_slug),
      store_category = COALESCE(@storeCategory, store_category),
      rating = COALESCE(@rating, rating),
      rating_count = COALESCE(@ratingCount, rating_count),
      condition = @condition,
      availability = @availability,
      marketplace = @marketplace,
      seller_name = @sellerName,
      last_seen_at = @ts, is_active = 1
    WHERE id = @id
  `);

  const applyPriceChange = conn.prepare(`
    UPDATE products
       SET current_price = @price, list_price = @listPrice,
           in_stock = @inStock, last_price_change_at = @ts
     WHERE id = @id
  `);

  const insertPricePoint = conn.prepare(`
    INSERT INTO price_points (product_id, price, list_price, in_stock, observed_at)
    VALUES (@id, @price, @listPrice, @inStock, @ts)
  `);

  conn.transaction(() => {
    for (const p of batch) {
      stats.seen++;

      const common = {
        url: p.url,
        title: p.title,
        model: p.model ?? null,
        imageUrl: p.imageUrl ?? null,
        description: cleanDescription(p.description),
        categorySlug: p.categorySlug ?? null,
        storeCategory: p.storeCategory ?? null,
        rating: normalizeRating(p.rating, p.ratingCount).rating,
        ratingCount: normalizeRating(p.rating, p.ratingCount).count,
        condition: p.condition ?? 'new',
        availability: p.availability ?? 'les-deux',
        marketplace: p.marketplace ? 1 : 0,
        sellerName: p.sellerName ?? null,
        price: p.price,
        listPrice: sanitizeListPrice(p.listPrice ?? null, p.price),
        inStock: p.inStock === null || p.inStock === undefined ? null : p.inStock ? 1 : 0,
        ts,
      };

      const existing = selectExisting.get(storeId, p.sku);

      if (!existing) {
        const info = insertProduct.run({
          ...common,
          storeId,
          sku: p.sku,
          brand: p.brand ?? null,
          currency: p.currency ?? 'CAD',
        });
        insertPricePoint.run({ ...common, id: Number(info.lastInsertRowid) });
        stats.created++;
        continue;
      }

      touchProduct.run({ ...common, id: existing.id });

      const changed =
        !samePrice(existing.current_price, p.price) ||
        !samePrice(existing.list_price, common.listPrice) ||
        existing.in_stock !== common.inStock;

      if (changed) {
        applyPriceChange.run({ ...common, id: existing.id });
        insertPricePoint.run({ ...common, id: existing.id });
        stats.priceChanges++;
      }
    }
  })();
}

/**
 * Marque inactifs les produits qu'on n'a plus vus depuis N jours.
 * Sans ça, le site continuerait d'afficher des « deals » sur des produits
 * retirés du catalogue depuis des mois.
 */
export function retireStaleProducts(storeId: string, days = 14): number {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return db()
    .prepare('UPDATE products SET is_active = 0 WHERE store_id = ? AND last_seen_at < ? AND is_active = 1')
    .run(storeId, cutoff).changes;
}
