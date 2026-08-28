import { db, nowIso } from '../db/index';
import { getStore } from '../scraping/registry';
import { HttpClient } from '../scraping/core/http';
import { resolveEnrichment } from './resolver';
import { bestBuyDetailSource, bestBuyReviewsSource } from './sources/bestbuy';
import { crossStoreSource } from './sources/cross-store';
import { manufacturerPriceSource } from './sources/manufacturer';
import type { EnrichmentSource, ProductRef } from './types';

/**
 * Orchestrateur d'enrichissement.
 *
 * Le choix DE QUOI enrichir est aussi important que la façon de le faire.
 * Enrichir 50 000 produits coûterait 100 000 requêtes pour un résultat que
 * personne ne regardera. On enrichit donc en priorité les produits où
 * l'information manquante CHANGE le résultat : ceux qui pourraient atteindre
 * la page d'accueil mais dont la qualité est encore inconnue.
 *
 * C'est la différence entre un système lourd et un système efficace : dépenser
 * les requêtes là où elles modifient une décision.
 */

export const ALL_SOURCES: EnrichmentSource[] = [
  bestBuyDetailSource,
  bestBuyReviewsSource,
  crossStoreSource,
  manufacturerPriceSource,
];

export interface EnrichOptions {
  storeId: string;
  limit?: number;
  /** Réenrichir même les produits déjà traités (après N jours). */
  refreshAfterDays?: number;
  signal?: AbortSignal;
  log?: (msg: string) => void;
}

export interface EnrichResult {
  attempted: number;
  ok: number;
  partial: number;
  failed: number;
  requests: number;
}

interface QueueRow {
  id: number;
  store_id: string;
  store_sku: string;
  title: string;
  url: string;
  brand: string | null;
  model: string | null;
  category_slug: string | null;
  current_price: number | null;
}

/**
 * File de priorité.
 *
 * Un produit mérite d'être enrichi s'il lui manque quelque chose d'utile
 * (marque, ou avis trop peu nombreux pour juger). Le tri privilégie ceux dont
 * le score provisoire est élevé : ce sont eux qui risquent de se retrouver en
 * vedette, donc ceux sur lesquels une erreur coûterait le plus cher.
 */
export function selectForEnrichment(
  storeId: string,
  limit: number,
  refreshAfterDays: number,
): QueueRow[] {
  const staleBefore = new Date(Date.now() - refreshAfterDays * 86_400_000).toISOString();

  return db()
    .prepare<[string, string], QueueRow>(
      `SELECT p.id, p.store_id, p.store_sku, p.title, p.url,
              p.brand, p.model, p.category_slug, p.current_price
         FROM products p
         LEFT JOIN product_enrichment e ON e.product_id = p.id
         LEFT JOIN deal_scores s        ON s.product_id = p.id
        WHERE p.store_id = ?
          AND p.is_active = 1
          AND (p.brand IS NULL OR p.rating IS NULL OR COALESCE(p.rating_count, 0) < 20)
          AND (e.product_id IS NULL
               OR (e.status != 'ok' AND e.attempts < 3)
               OR e.enriched_at < ?)
        ORDER BY COALESCE(s.score, 0) DESC, p.current_price DESC`,
    )
    .all(storeId, staleBefore)
    .slice(0, limit);
}

export async function enrichStore(opts: EnrichOptions): Promise<EnrichResult> {
  const conn = db();
  const store = getStore(opts.storeId);
  const log = opts.log ?? (() => {});
  const limit = opts.limit ?? 200;

  const queue = selectForEnrichment(store.id, limit, opts.refreshAfterDays ?? 30);
  const result: EnrichResult = { attempted: 0, ok: 0, partial: 0, failed: 0, requests: 0 };
  if (queue.length === 0) return result;

  log(`${queue.length} produit(s) à enrichir pour ${store.name}.`);

  // Chaque produit déclenche jusqu'à 2 requêtes : on ralentit le débit pour
  // rester dans la même enveloppe de politesse que le crawl.
  const http = new HttpClient({ requestsPerSecond: store.requestsPerSecond * 0.8 });
  const signal = opts.signal ?? new AbortController().signal;

  const httpFacade = {
    getJson: <T>(url: string, init?: RequestInit) => http.getJson<T>(url, init, signal),
    getText: (url: string, init?: RequestInit) => http.getText(url, init, signal),
  };

  const upsert = conn.prepare(`
    INSERT INTO product_enrichment (
      product_id, brand, model, manufacturer, rating, rating_count,
      rating_histogram, recommend_yes, recommend_total,
      sources, agreement, conflicts, status, attempts, last_error, enriched_at
    ) VALUES (
      @id, @brand, @model, @manufacturer, @rating, @ratingCount,
      @histogram, @recYes, @recTotal,
      @sources, @agreement, @conflicts, @status, 1, @error, @ts
    )
    ON CONFLICT(product_id) DO UPDATE SET
      brand = COALESCE(excluded.brand, product_enrichment.brand),
      model = COALESCE(excluded.model, product_enrichment.model),
      manufacturer = COALESCE(excluded.manufacturer, product_enrichment.manufacturer),
      rating = COALESCE(excluded.rating, product_enrichment.rating),
      rating_count = COALESCE(excluded.rating_count, product_enrichment.rating_count),
      rating_histogram = COALESCE(excluded.rating_histogram, product_enrichment.rating_histogram),
      recommend_yes = COALESCE(excluded.recommend_yes, product_enrichment.recommend_yes),
      recommend_total = COALESCE(excluded.recommend_total, product_enrichment.recommend_total),
      sources = excluded.sources,
      agreement = excluded.agreement,
      conflicts = excluded.conflicts,
      status = excluded.status,
      attempts = product_enrichment.attempts + 1,
      last_error = excluded.last_error,
      enriched_at = excluded.enriched_at
  `);

  // Les faits enrichis remontent dans products : c'est cette table que lisent
  // le moteur de score et le site. product_enrichment garde la provenance.
  const applyToProduct = conn.prepare(`
    UPDATE products SET
      brand = COALESCE(@brand, brand),
      model = COALESCE(@model, model),
      rating = COALESCE(@rating, rating),
      rating_count = CASE
        WHEN @ratingCount IS NOT NULL AND @ratingCount > COALESCE(rating_count, 0)
        THEN @ratingCount ELSE rating_count END
    WHERE id = @id
  `);

  for (const row of queue) {
    if (signal.aborted) break;
    result.attempted++;

    const ref: ProductRef = {
      id: row.id,
      storeId: row.store_id,
      storeSku: row.store_sku,
      title: row.title,
      url: row.url,
      brand: row.brand,
      model: row.model,
      categorySlug: row.category_slug,
      currentPrice: row.current_price,
    };

    try {
      const resolved = await resolveEnrichment(ref, ALL_SOURCES, httpFacade);
      const f = resolved.facts;

      const payload = {
        id: row.id,
        brand: f.brand ?? null,
        model: f.model ?? null,
        manufacturer: f.manufacturer ?? null,
        rating: f.rating ?? null,
        ratingCount: f.ratingCount ?? null,
        histogram: f.ratingHistogram ? JSON.stringify(f.ratingHistogram) : null,
        recYes: f.recommendYes ?? null,
        recTotal: f.recommendTotal ?? null,
        sources: JSON.stringify(resolved.sources),
        agreement: resolved.agreement,
        conflicts: resolved.conflicts.length ? JSON.stringify(resolved.conflicts) : null,
        status: resolved.status,
        error: null as string | null,
        ts: nowIso(),
      };

      conn.transaction(() => {
        upsert.run(payload);
        applyToProduct.run(payload);

        // Un prix constructeur est une RÉFÉRENCE, pas une offre concurrente :
        // il rejoint price_references, où le moteur de score le lit comme
        // quatrième signal — au même titre qu'une fourchette trouvée sur le web,
        // mais avec une confiance bien supérieure.
        if (f.manufacturerPrice && f.manufacturerPrice > 0) {
          conn
            .prepare(
              `INSERT INTO price_references (
                 product_id, launch_price, typical_price, currency,
                 sources, notes, confidence, found, model, cost_usd, checked_at
               ) VALUES (@id, @prix, @prix, 'CAD', @sources, @notes, 0.88, 1,
                         'manufacturer', 0, @ts)
               ON CONFLICT(product_id) DO UPDATE SET
                 launch_price = excluded.launch_price,
                 typical_price = excluded.typical_price,
                 sources = excluded.sources,
                 notes = excluded.notes,
                 confidence = excluded.confidence,
                 found = 1,
                 checked_at = excluded.checked_at`,
            )
            .run({
              id: row.id,
              prix: f.manufacturerPrice,
              sources: JSON.stringify([f.manufacturerUrl].filter(Boolean)),
              notes: `Prix officiel ${f.manufacturerName ?? 'constructeur'} : ${f.manufacturerPrice.toFixed(2)} $`,
              ts: nowIso(),
            });
        }
      })();

      if (resolved.status === 'ok') result.ok++;
      else if (resolved.status === 'partial') result.partial++;
      else result.failed++;

      if (result.attempted % 25 === 0) {
        log(`  … ${result.attempted}/${queue.length} (${result.ok} ok)`);
      }
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      upsert.run({
        id: row.id, brand: null, model: null, manufacturer: null,
        rating: null, ratingCount: null, histogram: null, recYes: null, recTotal: null,
        sources: '[]', agreement: 0, conflicts: null, status: 'failed',
        error: message.slice(0, 300), ts: nowIso(),
      });
    }
  }

  result.requests = http.requestCount;
  return result;
}
