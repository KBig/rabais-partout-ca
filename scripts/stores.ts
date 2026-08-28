/**
 * Tableau de bord console : état des magasins, santé des crawls, meilleurs deals.
 *
 *   npm run stores
 */
import { db, migrate } from '../src/lib/db/index';
import { STORES } from '../src/lib/scraping/registry';

migrate();
const c = db();

const money = (n: number | null) => (n === null ? '—' : `${n.toFixed(2)} $`);
const pad = (s: string | number, n: number) => String(s).padEnd(n);

console.log('\n════ MAGASINS ════\n');
for (const s of STORES) {
  const row = c
    .prepare(
      `SELECT COUNT(*) n,
              SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) actifs,
              MAX(last_seen_at) vu
         FROM products WHERE store_id = ?`,
    )
    .get(s.id) as { n: number; actifs: number | null; vu: string | null };

  const health = c
    .prepare('SELECT consecutive_failures f, paused_until p FROM stores WHERE id = ?')
    .get(s.id) as { f: number; p: string | null } | undefined;

  const state = !s.adapter
    ? 'à venir'
    : health?.p && health.p > new Date().toISOString()
      ? `EN PAUSE (${health.f} échecs)`
      : 'actif';

  console.log(
    `  ${pad(s.name, 16)} ${pad(state, 22)} ${pad(row.n + ' produits', 18)}` +
      (row.vu ? `dernier passage ${row.vu.slice(0, 16).replace('T', ' ')}` : ''),
  );
}

const runs = c
  .prepare(
    `SELECT store_id, strategy, target, status, products_seen, price_changes,
            requests_made, started_at, error
       FROM crawl_runs ORDER BY started_at DESC LIMIT 8`,
  )
  .all() as any[];

if (runs.length) {
  console.log('\n════ DERNIERS CRAWLS ════\n');
  for (const r of runs) {
    console.log(
      `  ${r.started_at.slice(5, 16).replace('T', ' ')}  ${pad(r.store_id, 15)}` +
        `${pad(r.strategy + (r.target ? ':' + r.target : ''), 26)}${pad(r.status, 9)}` +
        `${pad(r.products_seen + ' vus', 12)}${pad(r.price_changes + ' chg', 9)}${r.requests_made} req` +
        (r.error ? `\n      ⚠ ${r.error.slice(0, 100)}` : ''),
    );
  }
}

const agg = c
  .prepare(
    `SELECT COUNT(*) n, ROUND(AVG(score),1) avg, ROUND(MAX(score),1) max,
            ROUND(AVG(confidence),2) conf,
            SUM(CASE WHEN is_lowest_ever=1 THEN 1 ELSE 0 END) lowest
       FROM deal_scores`,
  )
  .get() as any;

console.log('\n════ MOTEUR DE SCORE ════\n');
console.log(
  `  ${agg.n ?? 0} produits notés · score moyen ${agg.avg ?? '—'} · max ${agg.max ?? '—'}` +
    ` · confiance moyenne ${agg.conf ?? '—'} · ${agg.lowest ?? 0} au plus bas historique`,
);

const top = c
  .prepare(
    `SELECT p.title, p.current_price cp, p.list_price lp, p.rating r, p.rating_count rc,
            ROUND(s.score,1) score, ROUND(s.confidence,2) conf, ROUND(s.quality_score,2) q, s.reasons
       FROM deal_scores s JOIN products p ON p.id = s.product_id
      WHERE p.is_active = 1
      ORDER BY s.score DESC LIMIT 8`,
  )
  .all() as any[];

if (top.length) {
  console.log('\n════ MEILLEURS DEALS ════\n');
  for (const r of top) {
    console.log(
      `  [${String(r.score).padStart(5)}] conf ${r.conf} · qualité ${r.q} · ` +
        `${money(r.cp)}${r.lp ? ` (rég. ${money(r.lp)})` : ''} · ` +
        `${r.r ? r.r + '/5' : 'non noté'} (${r.rc ?? 0} avis)`,
    );
    console.log(`          ${r.title.slice(0, 92)}`);
    console.log(`          → ${JSON.parse(r.reasons || '[]').join(' · ')}\n`);
  }
}
console.log();
