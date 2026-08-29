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
    .prepare<[string, string, number], QueueRow>(
      `SELECT p.id, p.store_id, p.store_sku, p.title, p.url,
              p.brand, p.model, p.category_slug, p.current_price
         FROM products p
         LEFT JOIN product_enrichment e ON e.product_id = p.id
         LEFT JOIN deal_scores s        ON s.product_id = p.id
        WHERE p.store_id = ?
          AND p.is_active = 1
          AND (
            -- Il manque une information de base.
            p.brand IS NULL OR p.rating IS NULL OR COALESCE(p.rating_count, 0) < 20

            -- OU tout est la pour aller chercher le prix du fabricant, et on ne
            -- l'a pas encore fait.
            --
            -- Cette seconde branche manquait, et son absence annulait toute la
            -- chaine : le critere « la marque est ABSENTE » avait ete ecrit
            -- quand la marque etait justement ce qu'il fallait remplir. Le prix
            -- constructeur exige l'inverse — que la marque soit PRESENTE — si
            -- bien que la file excluait exactement les produits capables d'en
            -- obtenir un. Zero reference n'est jamais tombee, avec pourtant une
            -- machinerie complete derriere.
            OR (p.brand IS NOT NULL AND p.brand <> ''
                AND p.model IS NOT NULL AND p.model <> ''
                AND NOT EXISTS (SELECT 1 FROM price_references r WHERE r.product_id = p.id))
          )
          AND (e.product_id IS NULL
               OR (e.status != 'ok' AND e.attempts < 3)
               OR e.enriched_at < ?)
        ORDER BY COALESCE(s.score, 0) DESC, p.current_price DESC
        LIMIT ?`,
    )
    // Le plafond est pose PAR SQLITE, pas apres coup. La version precedente
    // ramenait toutes les lignes eligibles — 282 000 pour Best Buy — avant d'en
    // garder 250. Le tri devait alors porter sur l'ensemble, a chaque cycle.
    //
    // Le vivier est plus large que le besoin parce que le tri s'affine ensuite :
    // certaines lignes seront ecartees faute de source applicable.
    .all(storeId, staleBefore, Math.max(limit, VIVIER_PAR_BESOIN * limit));
}

/** Combien de candidats ramener pour en retenir un. */
const VIVIER_PAR_BESOIN = 8;

/**
 * Une source peut-elle apprendre quelque chose sur ce produit ?
 *
 * Sans ce filtre, la file tentait des produits qu'AUCUNE source ne couvre. Chez
 * Costco — pas de modele publie, donc ni prix constructeur ni rapprochement
 * entre magasins — cela donnait « 250 echecs, 0 requete » a chaque cycle :
 * quatre-vingt-dix secondes a ecrire des lignes d'echec, tout le creneau du
 * magasin, pour une information qu'on savait d'avance inaccessible.
 *
 * Et l'echec ne remplissant pas la marque, la requete resselectionnait
 * exactement les memes produits au cycle suivant. Une boucle parfaitement
 * stable, et parfaitement sterile.
 */
export function uneSourcePeutAider(ref: ProductRef): boolean {
  return ALL_SOURCES.some((s) => s.supports(ref));
}

/** Une ligne de file vue comme un produit. Partage par le filtre et la boucle. */
const refDe = (row: QueueRow): ProductRef => ({
  id: row.id,
  storeId: row.store_id,
  storeSku: row.store_sku,
  title: row.title,
  url: row.url,
  brand: row.brand,
  model: row.model,
  categorySlug: row.category_slug,
  currentPrice: row.current_price,
});

export async function enrichStore(opts: EnrichOptions): Promise<EnrichResult> {
  const conn = db();
  const store = getStore(opts.storeId);
  const log = opts.log ?? (() => {});
  const limit = opts.limit ?? 200;

  const candidats = selectForEnrichment(store.id, limit, opts.refreshAfterDays ?? 30);
  const result: EnrichResult = { attempted: 0, ok: 0, partial: 0, failed: 0, requests: 0 };

  // On ne tente que ce qui peut aboutir. Un produit qu'aucune source ne couvre
  // echouerait sans meme faire de requete, et reviendrait a l'identique au
  // cycle suivant.
  const queue = candidats.filter((row) => uneSourcePeutAider(refDe(row))).slice(0, limit);
  if (queue.length === 0) {
    if (candidats.length > 0) {
      log(
        `${store.name} : ${candidats.length} produit(s) en attente, mais aucune source ` +
          `applicable (ni modele publie, ni marque a site verifie).`,
      );
    }
    return result;
  }

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
      rating_histogram, recommend_yes, recommend_total, reviews,
      sources, agreement, conflicts, status, attempts, last_error, enriched_at
    ) VALUES (
      @id, @brand, @model, @manufacturer, @rating, @ratingCount,
      @histogram, @recYes, @recTotal, @reviews,
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
      reviews = COALESCE(excluded.reviews, product_enrichment.reviews),
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

    const ref = refDe(row);

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
        reviews: f.reviews?.length ? JSON.stringify(f.reviews) : null,
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
        reviews: null,
        sources: '[]', agreement: 0, conflicts: null, status: 'failed',
        error: message.slice(0, 300), ts: nowIso(),
      });
    }
  }

  result.requests = http.requestCount;
  return result;
}
