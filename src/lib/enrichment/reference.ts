import Anthropic from '@anthropic-ai/sdk';
import { db, nowIso } from '../db';

/**
 * Quatrième signal : fourchette de prix de RÉFÉRENCE, issue de sources web
 * citées.
 *
 * ----------------------------------------------------------------------------
 * POURQUOI CE MODULE EXISTE, ET CE QU'IL NE FAIT PAS
 * ----------------------------------------------------------------------------
 *
 * Il existe bien de l'information exploitable sur le web à propos des prix :
 * le PDSF officiel d'Apple, la couverture éditoriale des soldes (« tombé à
 * 218 $ au Black Friday »), les prix courants chez d'autres marchands. C'est
 * réel, daté, et citable.
 *
 * Ce qui n'existe pas, c'est une série temporelle par référence produit. Et la
 * couverture s'effondre dès qu'on quitte les produits vedettes : les AirPods
 * Pro 2 sont documentés partout, un portable Dell de série l'est nulle part.
 *
 * Le piège à éviter absolument : un modèle de langage SAIT produire une réponse
 * plausible même sans source. « Ce téléviseur est descendu à 899 $ en
 * novembre » sort avec exactement le même aplomb qu'il soit vérifié ou inventé.
 * Injecter ça dans la base donnerait un site affichant « plus bas prix depuis
 * 6 mois » sur des chiffres qui n'ont jamais existé — bien pire que d'admettre
 * qu'on ne sait pas.
 *
 * Trois garde-fous structurels, donc :
 *
 *  1. RECHERCHE WEB OBLIGATOIRE. On active l'outil de recherche : le modèle
 *     doit consulter des pages réelles, pas sa mémoire.
 *  2. PAS D'URL, PAS DE FAIT. Chaque chiffre doit être accompagné de sa source.
 *     Le prompt rend « je n'ai pas trouvé » explicitement acceptable — c'est la
 *     réponse attendue pour la majorité du catalogue.
 *  3. TABLE SÉPARÉE. Ces valeurs ne rejoignent JAMAIS price_points. Ce sont des
 *     estimations sourcées, pas des observations. Le moteur de score leur donne
 *     un poids faible et l'interface les étiquette comme telles.
 */

const MODEL = 'claude-opus-5';

/** Fiabilité intrinsèque du signal. Sourcé, donc mieux que le prix barré du
 *  marchand (0,3), mais grossier, donc loin derrière notre propre historique. */
export const REFERENCE_RELIABILITY = 0.45;

export interface PriceReference {
  launchPrice: number | null;
  typicalPrice: number | null;
  knownLow: number | null;
  currency: string;
  sources: string[];
  notes: string | null;
  confidence: number;
  found: boolean;
}

const SYSTEM = `Tu recherches des informations PUBLIQUES et SOURÇABLES sur le prix d'un produit précis, pour un comparateur de rabais canadien.

Tu dois trouver, uniquement si des sources réelles le documentent :
- le prix de lancement / PDSF officiel
- le prix courant habituel constaté chez les détaillants
- le plus bas prix documenté par une source citable (article de deals, page marchand)

RÈGLES ABSOLUES, dans cet ordre de priorité :

1. N'AFFIRME RIEN SANS URL. Chaque chiffre que tu rapportes doit provenir d'une page que tu as réellement consultée pendant cette recherche. Si tu ne peux pas citer d'URL pour un chiffre, ce chiffre ne doit pas apparaître.

2. « JE N'AI PAS TROUVÉ » EST LA BONNE RÉPONSE LA PLUPART DU TEMPS. La majorité des produits de détail (portables de série, petits électroménagers, accessoires) ne font l'objet d'AUCUNE couverture de prix. Pour ceux-là, réponds found: false. C'est un succès, pas un échec.

3. NE DÉDUIS JAMAIS UN PRIX DE TA MÉMOIRE. Si la recherche ne renvoie rien d'exploitable, ne comble pas le vide avec une estimation vraisemblable. Un chiffre inventé est bien plus nuisible qu'une absence de chiffre.

4. VÉRIFIE QUE C'EST LE BON PRODUIT. Un modèle voisin n'est pas le même produit. En cas de doute sur l'identité exacte, réponds found: false.

5. DEVISE. Rapporte en dollars canadiens. Si tes sources sont en USD, convertis-le et signale-le dans notes. Ne mélange pas les devises.

Réponds UNIQUEMENT avec un objet JSON, sans texte autour, de cette forme :
{
  "found": true|false,
  "launchPrice": nombre|null,
  "typicalPrice": nombre|null,
  "knownLow": nombre|null,
  "currency": "CAD",
  "sources": ["url", ...],
  "notes": "contexte bref, ex. « -218 $ au Black Friday 2024 selon X »"|null,
  "confidence": 0.0 à 1.0
}

confidence reflète la qualité des sources : 0,8+ pour une page officielle du fabricant, 0,5 pour un article de deals daté, 0,2 pour une mention vague et non datée.`;

/** Coût approximatif par appel, pour prévenir avant de dépenser. */
const APPROX_COST_USD = 0.06;

function client(): Anthropic {
  // Le SDK résout la clé depuis ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN ou un
  // profil `ant auth login`. On ne code jamais de clé en dur.
  return new Anthropic();
}

/**
 * Interroge le web pour un produit. Renvoie `found: false` sans drame quand
 * rien de sourcable n'existe — ce qui est le cas le plus fréquent.
 */
export async function lookupReference(product: {
  title: string;
  brand: string | null;
  model: string | null;
  currentPrice: number | null;
}): Promise<{ ref: PriceReference; costUsd: number }> {
  const identity = [product.brand, product.title, product.model && `modèle ${product.model}`]
    .filter(Boolean)
    .join(' — ');

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    tools: [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: 5,
      } as never,
    ],
    messages: [
      {
        role: 'user',
        content:
          `Produit : ${identity}\n` +
          `Prix affiché aujourd'hui au Canada : ${product.currentPrice ?? 'inconnu'} $ CAD\n\n` +
          `Cherche l'historique de prix documenté de CE produit précis. ` +
          `Si aucune source ne le documente, réponds found: false.`,
      },
    ],
  });

  // Les blocs de recherche web précèdent la réponse : on ne garde que le texte.
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  const ref = parseReference(text);

  const usage = response.usage;
  const costUsd =
    ((usage.input_tokens ?? 0) * 5 + (usage.output_tokens ?? 0) * 25) / 1_000_000;

  return { ref, costUsd };
}

/**
 * Extraction tolérante du JSON.
 *
 * Le modèle peut encadrer sa réponse d'une clôture Markdown malgré la
 * consigne. Plutôt que d'échouer, on récupère le premier objet JSON présent.
 * Et à la moindre incohérence, on retombe sur « rien trouvé » : ici, échouer
 * silencieusement vers l'absence de donnée est le comportement SÛR.
 */
function parseReference(text: string): PriceReference {
  const empty: PriceReference = {
    launchPrice: null,
    typicalPrice: null,
    knownLow: null,
    currency: 'CAD',
    sources: [],
    notes: null,
    confidence: 0,
    found: false,
  };

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return empty;

  let raw: any;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return empty;
  }

  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

  const sources = Array.isArray(raw.sources)
    ? raw.sources.filter((s: unknown) => typeof s === 'string' && s.startsWith('http'))
    : [];

  const launchPrice = numOrNull(raw.launchPrice);
  const typicalPrice = numOrNull(raw.typicalPrice);
  const knownLow = numOrNull(raw.knownLow);

  // Garde-fou final, appliqué en TypeScript et non délégué au modèle : sans
  // source citée, ou sans le moindre chiffre, le résultat est « non trouvé ».
  const hasFigure = launchPrice !== null || typicalPrice !== null || knownLow !== null;
  const found = raw.found === true && sources.length > 0 && hasFigure;

  return {
    launchPrice: found ? launchPrice : null,
    typicalPrice: found ? typicalPrice : null,
    knownLow: found ? knownLow : null,
    currency: typeof raw.currency === 'string' ? raw.currency : 'CAD',
    sources,
    notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 400) : null,
    confidence: found ? Math.min(1, Math.max(0, Number(raw.confidence) || 0)) : 0,
    found,
  };
}

interface Candidate {
  id: number;
  title: string;
  brand: string | null;
  model: string | null;
  current_price: number | null;
}

/**
 * Sélectionne les produits à interroger.
 *
 * Chaque appel coûte de l'argent réel (~0,06 $ US) et prend plusieurs secondes.
 * On cible donc uniquement les produits où la réponse CHANGE quelque chose :
 * ceux qui sont bien classés mais dont l'historique observé est encore trop
 * court pour trancher.
 */
export function selectForReference(limit: number, refreshAfterDays = 45): Candidate[] {
  const stale = new Date(Date.now() - refreshAfterDays * 86_400_000).toISOString();

  return db()
    .prepare<[string], Candidate>(
      `SELECT p.id, p.title, p.brand, p.model, p.current_price
         FROM products p
         JOIN deal_scores s ON s.product_id = p.id
         LEFT JOIN price_references r ON r.product_id = p.id
        WHERE p.is_active = 1
          AND s.days_of_history < 21
          AND (r.product_id IS NULL OR r.checked_at < ?)
        ORDER BY s.score DESC`,
    )
    .all(stale)
    .slice(0, limit);
}

export function saveReference(
  productId: number,
  ref: PriceReference,
  costUsd: number,
): void {
  db()
    .prepare(
      `INSERT INTO price_references (
         product_id, launch_price, typical_price, known_low, currency,
         sources, notes, confidence, found, model, cost_usd, checked_at
       ) VALUES (
         @id, @launch, @typical, @low, @currency,
         @sources, @notes, @confidence, @found, @model, @cost, @ts
       )
       ON CONFLICT(product_id) DO UPDATE SET
         launch_price = excluded.launch_price,
         typical_price = excluded.typical_price,
         known_low = excluded.known_low,
         currency = excluded.currency,
         sources = excluded.sources,
         notes = excluded.notes,
         confidence = excluded.confidence,
         found = excluded.found,
         model = excluded.model,
         cost_usd = excluded.cost_usd,
         checked_at = excluded.checked_at`,
    )
    .run({
      id: productId,
      launch: ref.launchPrice,
      typical: ref.typicalPrice,
      low: ref.knownLow,
      currency: ref.currency,
      sources: JSON.stringify(ref.sources),
      notes: ref.notes,
      confidence: ref.confidence,
      found: ref.found ? 1 : 0,
      model: MODEL,
      cost: costUsd,
      ts: nowIso(),
    });
}

export const estimatedCost = (n: number) => n * APPROX_COST_USD;
