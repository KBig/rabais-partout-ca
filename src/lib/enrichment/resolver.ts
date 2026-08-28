import type {
  EnrichedFacts,
  EnrichmentSource,
  EnrichmentHttp,
  ProductRef,
  ResolvedEnrichment,
  SourceResult,
} from './types';

/**
 * Fusionne les faits venus de plusieurs sources et MESURE leur accord.
 *
 * L'erreur classique serait de prendre « la première source qui répond ».
 * Ici on interroge toutes les sources disponibles, on retient la valeur la
 * mieux soutenue, et on conserve les désaccords.
 *
 * L'accord n'est pas décoratif : il alimente la confiance affichée. Une marque
 * confirmée par deux sources indépendantes n'a pas le même statut qu'une
 * marque avancée par une seule, et une note contredite entre magasins doit
 * faire BAISSER la confiance, pas être moyennée en silence.
 */

/** Tolérances au-delà desquelles deux valeurs sont considérées en désaccord. */
const RATING_TOLERANCE = 0.2; // étoiles
const COUNT_TOLERANCE = 0.25; // écart relatif sur le nombre d'avis

export async function resolveEnrichment(
  product: ProductRef,
  sources: EnrichmentSource[],
  http: EnrichmentHttp,
): Promise<ResolvedEnrichment> {
  const applicable = sources.filter((s) => s.supports(product));
  if (applicable.length === 0) {
    return { facts: {}, sources: [], agreement: 0, conflicts: [], status: 'failed' };
  }

  // Les sources sont indépendantes : on les interroge en parallèle, et l'échec
  // de l'une ne doit jamais faire tomber les autres.
  const settled = await Promise.allSettled(
    applicable.map(async (s): Promise<SourceResult | null> => {
      const facts = await s.fetch(product, http);
      return facts ? { sourceId: s.id, facts, reliability: s.reliability } : null;
    }),
  );

  const results: SourceResult[] = [];
  const failures: string[] = [];

  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) results.push(r.value);
    else if (r.status === 'rejected') {
      failures.push(`${applicable[i].id}: ${r.reason?.message ?? r.reason}`);
    }
  });

  if (results.length === 0) {
    return {
      facts: {},
      sources: [],
      agreement: 0,
      conflicts: failures,
      status: 'failed',
    };
  }

  const conflicts: string[] = [];
  const agreements: number[] = [];
  const facts: EnrichedFacts = {};

  // --- Champs textuels ------------------------------------------------------
  for (const field of ['brand', 'model', 'manufacturer'] as const) {
    const picked = pickString(results, field, conflicts);
    if (picked) {
      facts[field] = picked.value;
      if (picked.contributors > 1) agreements.push(picked.agreement);
    }
  }

  // --- Note moyenne ---------------------------------------------------------
  const rating = pickNumber(
    results,
    'rating',
    (a, b) => Math.abs(a - b) <= RATING_TOLERANCE,
    'note',
    conflicts,
  );
  if (rating) {
    facts.rating = rating.value;
    if (rating.contributors > 1) agreements.push(rating.agreement);
  }

  // --- Nombre d'avis : on retient le MAXIMUM ------------------------------
  // Un magasin peut n'exposer qu'une partie des avis. Le plus grand volume
  // observé est le plus proche de la réalité, pas la moyenne des volumes.
  const counts = collect(results, 'ratingCount').filter((c) => typeof c.value === 'number');
  if (counts.length > 0) {
    const max = counts.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a));
    facts.ratingCount = max.value as number;
    if (counts.length > 1) {
      const ref = max.value as number;
      const agreeing = counts.filter(
        (c) => ref === 0 || Math.abs((c.value as number) - ref) / ref <= COUNT_TOLERANCE,
      );
      agreements.push(agreeing.length / counts.length);
      if (agreeing.length < counts.length) {
        conflicts.push(
          `nombre d'avis divergent : ${counts.map((c) => `${c.sourceId}=${c.value}`).join(', ')}`,
        );
      }
    }
  }

  // --- Données binomiales et histogramme -----------------------------------
  // Pas de fusion : on prend l'échantillon le plus large, car mélanger deux
  // binomiales de populations différentes n'aurait aucun sens statistique.
  const binomials = results
    .filter((r) => typeof r.facts.recommendTotal === 'number' && r.facts.recommendTotal! > 0)
    .sort((a, b) => (b.facts.recommendTotal ?? 0) - (a.facts.recommendTotal ?? 0));
  if (binomials.length > 0) {
    facts.recommendYes = binomials[0].facts.recommendYes ?? null;
    facts.recommendTotal = binomials[0].facts.recommendTotal ?? null;
  }

  // Les avis viennent d'une seule source a la fois : on prend celle qui en a.
  const avecAvis = results.find((r) => (r.facts.reviews?.length ?? 0) > 0);
  if (avecAvis) facts.reviews = avecAvis.facts.reviews ?? null;

  const withHistogram = results.find((r) => r.facts.ratingHistogram);
  if (withHistogram) facts.ratingHistogram = withHistogram.facts.ratingHistogram ?? null;

  // Une seule source qui répond : rien à corroborer. On plafonne l'accord à
  // 0,6 pour ne jamais faire passer une source isolée pour une certitude.
  const agreement =
    agreements.length > 0
      ? agreements.reduce((a, b) => a + b, 0) / agreements.length
      : results.length > 1
        ? 0.8
        : 0.6;

  const gotAnything = Object.values(facts).some((v) => v !== null && v !== undefined);

  // Une source qui repond « je n'ai rien sur ce produit » n'est PAS un echec.
  // Seule une exception compte comme tel. Sans cette distinction, la source
  // inter-magasins marquerait tout en « partiel » tant qu'un seul magasin est
  // alimente, ce qui rendrait le statut inexploitable.
  const status: ResolvedEnrichment['status'] = !gotAnything
    ? 'failed'
    : failures.length > 0
      ? 'partial'
      : 'ok';

  return {
    facts,
    sources: results.map((r) => r.sourceId),
    agreement,
    conflicts: [...conflicts, ...failures],
    status,
  };
}

interface Candidate {
  sourceId: string;
  reliability: number;
  value: unknown;
}

function collect(results: SourceResult[], field: keyof EnrichedFacts): Candidate[] {
  return results
    .filter((r) => r.facts[field] !== null && r.facts[field] !== undefined)
    .map((r) => ({ sourceId: r.sourceId, reliability: r.reliability, value: r.facts[field] }));
}

/**
 * Retient la valeur textuelle la mieux soutenue, en additionnant la fiabilité
 * des sources qui la proposent. Deux sources moyennes concordantes peuvent
 * ainsi l'emporter sur une source unique très fiable.
 */
function pickString(
  results: SourceResult[],
  field: 'brand' | 'model' | 'manufacturer',
  conflicts: string[],
): { value: string; agreement: number; contributors: number } | null {
  const cands = collect(results, field).filter((c) => typeof c.value === 'string' && c.value);
  if (cands.length === 0) return null;

  const weights = new Map<string, { weight: number; display: string; n: number }>();
  for (const c of cands) {
    const key = String(c.value).toLowerCase().replace(/\s+/g, ' ').trim();
    const cur = weights.get(key) ?? { weight: 0, display: String(c.value), n: 0 };
    cur.weight += c.reliability;
    cur.n += 1;
    weights.set(key, cur);
  }

  const best = [...weights.entries()].sort((a, b) => b[1].weight - a[1].weight)[0];

  if (weights.size > 1) {
    conflicts.push(
      `${field} divergent : ${cands.map((c) => `${c.sourceId}="${c.value}"`).join(', ')}`,
    );
  }

  return {
    value: best[1].display,
    agreement: best[1].n / cands.length,
    contributors: cands.length,
  };
}

/** Moyenne pondérée par la fiabilité, avec relevé des valeurs hors tolérance. */
function pickNumber(
  results: SourceResult[],
  field: 'rating',
  agrees: (a: number, b: number) => boolean,
  label: string,
  conflicts: string[],
): { value: number; agreement: number; contributors: number } | null {
  const cands = collect(results, field).filter((c) => typeof c.value === 'number');
  if (cands.length === 0) return null;

  const totalW = cands.reduce((s, c) => s + c.reliability, 0);
  const weighted = cands.reduce((s, c) => s + (c.value as number) * c.reliability, 0) / totalW;

  const agreeing = cands.filter((c) => agrees(c.value as number, weighted));
  if (agreeing.length < cands.length) {
    conflicts.push(`${label} divergente : ${cands.map((c) => `${c.sourceId}=${c.value}`).join(', ')}`);
  }

  return {
    value: weighted,
    agreement: agreeing.length / cands.length,
    contributors: cands.length,
  };
}
