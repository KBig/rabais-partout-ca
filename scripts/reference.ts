/**
 * CLI de recherche de fourchette de prix de référence.
 *
 *   npm run reference -- --limit 10
 *   npm run reference -- --limit 10 --yes     (sans confirmation)
 *
 * ATTENTION : cette commande appelle l'API Claude avec recherche web activée.
 * Elle coûte de l'argent réel (~0,06 $ US par produit) et prend quelques
 * secondes par appel. Elle demande donc confirmation avant de dépenser, et
 * n'est jamais lancée automatiquement par l'ordonnanceur.
 */
import { migrate } from '../src/lib/db/index';
import {
  selectForReference,
  lookupReference,
  saveReference,
  estimatedCost,
} from '../src/lib/enrichment/reference';
import { scoreAll } from '../src/lib/pricing/score';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const limit = Math.min(200, Number(arg('limit') ?? 10));

migrate();

const candidates = selectForReference(limit);
if (candidates.length === 0) {
  console.log('Aucun produit à interroger : tous ont déjà une référence récente.');
  process.exit(0);
}

console.log(
  `\n${candidates.length} produit(s) à interroger.\n` +
    `Coût estimé : ~${estimatedCost(candidates.length).toFixed(2)} $ US ` +
    `(API Claude + recherche web).\n`,
);

if (!flag('yes')) {
  console.log('Relancez avec --yes pour confirmer la dépense.');
  console.log('\nProduits ciblés :');
  for (const c of candidates.slice(0, 8)) {
    console.log(`  ${(c.current_price ?? 0).toFixed(2)} $  ${c.title.slice(0, 74)}`);
  }
  process.exit(0);
}

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());

let found = 0;
let empty = 0;
let failed = 0;
let spent = 0;

for (const [i, c] of candidates.entries()) {
  if (controller.signal.aborted) break;

  try {
    const { ref, costUsd } = await lookupReference({
      title: c.title,
      brand: c.brand,
      model: c.model,
      currentPrice: c.current_price,
    });

    saveReference(c.id, ref, costUsd);
    spent += costUsd;

    if (ref.found) {
      found++;
      const parts = [
        ref.launchPrice && `lancement ${ref.launchPrice} $`,
        ref.typicalPrice && `habituel ${ref.typicalPrice} $`,
        ref.knownLow && `plus bas connu ${ref.knownLow} $`,
      ].filter(Boolean);
      console.log(
        `  [${i + 1}/${candidates.length}] ✓ ${c.title.slice(0, 52)}\n` +
          `        ${parts.join(' · ')}  (confiance ${ref.confidence.toFixed(2)}, ` +
          `${ref.sources.length} source${ref.sources.length > 1 ? 's' : ''})`,
      );
    } else {
      empty++;
      console.log(`  [${i + 1}/${candidates.length}] — rien de sourçable : ${c.title.slice(0, 56)}`);
    }
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  [${i + 1}/${candidates.length}] ✗ ${msg.slice(0, 100)}`);
    // Une clé absente ou invalide ne se répare pas en réessayant 200 fois.
    if (/api[_ ]?key|authentication|credential/i.test(msg)) {
      console.error(
        '\nAucune information d’authentification utilisable.\n' +
          'Définissez ANTHROPIC_API_KEY, ou connectez-vous avec « ant auth login ».',
      );
      break;
    }
  }
}

console.log(
  `\n${found} référence(s) trouvée(s), ${empty} sans source exploitable, ` +
    `${failed} échec(s). Coût réel : ${spent.toFixed(3)} $ US.`,
);

if (found > 0) {
  console.log('Recalcul des scores…');
  console.log(`${scoreAll()} scores mis à jour.`);
}
