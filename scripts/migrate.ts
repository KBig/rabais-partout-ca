import { migrate, DB_PATH } from '../src/lib/db/index';
import { seedReferenceData } from '../src/lib/db/seed';

console.log(`Base : ${DB_PATH}`);
const applied = migrate(true);
console.log(applied.length ? `${applied.length} migration(s) appliquée(s).` : 'Schéma déjà à jour.');
seedReferenceData();
console.log('Données de référence (magasins + catégories) synchronisées.');
