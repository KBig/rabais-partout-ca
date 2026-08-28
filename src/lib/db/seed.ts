import { db } from './index';
import { CATEGORIES } from '../categories';
import { STORES } from '../scraping/registry';

/**
 * Synchronise les données de référence (magasins, catégories) depuis le code
 * vers la base. Idempotent : on peut le relancer à chaque migration.
 *
 * On garde le code comme source de vérité pour ces tables, et non la base :
 * ajouter un magasin ne doit jamais demander de SQL manuel.
 */
export function seedReferenceData(): void {
  const conn = db();

  const upsertCategory = conn.prepare(`
    INSERT INTO categories (slug, name, parent_slug, icon, sort_order)
    VALUES (@slug, @name, @parent, @icon, @order)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      parent_slug = excluded.parent_slug,
      icon = excluded.icon,
      sort_order = excluded.sort_order
  `);

  const upsertStore = conn.prepare(`
    INSERT INTO stores (id, name, kind, country, currency, homepage, color, enabled)
    VALUES (@id, @name, @kind, @country, @currency, @homepage, @color, @enabled)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      country = excluded.country,
      currency = excluded.currency,
      homepage = excluded.homepage,
      color = excluded.color,
      enabled = excluded.enabled
  `);

  conn.transaction(() => {
    // Les parents d'abord : la clé étrangère parent_slug l'exige.
    for (const c of CATEGORIES.filter((c) => !c.parent)) {
      upsertCategory.run({
        slug: c.slug,
        name: c.name,
        parent: null,
        icon: c.icon ?? null,
        order: CATEGORIES.indexOf(c),
      });
    }
    for (const c of CATEGORIES.filter((c) => c.parent)) {
      upsertCategory.run({
        slug: c.slug,
        name: c.name,
        parent: c.parent ?? null,
        icon: c.icon ?? null,
        order: CATEGORIES.indexOf(c),
      });
    }

    for (const s of STORES) {
      upsertStore.run({
        id: s.id,
        name: s.name,
        kind: s.kind,
        country: s.country,
        currency: s.currency,
        homepage: s.homepage,
        color: s.color,
        enabled: s.adapter ? 1 : 0,
      });
    }
  })();
}
