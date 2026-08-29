/**
 * Recalcule la distribution reelle de chaque caracteristique, par categorie.
 *
 *   npm run specs
 *
 * C'est ce qui permet de dire si « 16 Go » est genereux ou juste, en le
 * comparant a ce que fait le reste du marche plutot qu'a une table ecrite a la
 * main. A relancer apres chaque collecte.
 */
import { migrate } from '../src/lib/db/index';
import { buildSpecDistribution } from '../src/lib/quality/components';

migrate();

const debut = Date.now();
console.log('Distribution des caracteristiques…');
const res = buildSpecDistribution((m) => console.log(m));
console.log(
  `\n✓ ${res.retenues} distributions sur ${res.cles} combinaisons, ` +
    `${res.produits} produits, en ${((Date.now() - debut) / 1000).toFixed(1)} s.`,
);
