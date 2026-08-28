import Link from 'next/link';
import { categoriesWithCounts } from '@/lib/db/queries';
import { EmptyState } from '@/components/DealCard';
import { num } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const all = categoriesWithCounts();
  const roots = all.filter((c) => !c.parentSlug);

  // Le total d'une catégorie racine inclut ses sous-catégories : sans ça,
  // « Électronique » afficherait 0 alors que « Téléviseurs » en contient 1 900.
  const totalFor = (slug: string) =>
    all
      .filter((c) => c.slug === slug || c.parentSlug === slug)
      .reduce((sum, c) => sum + c.count, 0);

  const populated = roots.filter((c) => totalFor(c.slug) > 0);
  const upcoming = roots.filter((c) => totalFor(c.slug) === 0);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Catégories</h1>
        <p className="mt-1.5 text-sm text-muted">
          Taxonomie unifiée : un téléviseur reste un téléviseur, peu importe le magasin
          d&apos;où il vient.
        </p>
        <p className="mt-1 text-xs text-faint">
          Les nombres indiquent les produits que nous avons <em>indexés</em>, pas le
          catalogue complet du marchand.
        </p>
      </header>

      {populated.length === 0 ? (
        <EmptyState
          title="Aucune catégorie peuplée."
          hint="Lancez un crawl pour remplir la base."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {populated.map((root) => {
            const children = all.filter((c) => c.parentSlug === root.slug && c.count > 0);
            return (
              <div
                key={root.slug}
                className="rounded-card border border-line bg-surface p-4 transition-colors hover:border-line/70"
              >
                <Link
                  href={`/categories/${root.slug}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="text-base font-semibold">
                    {root.icon && <span className="mr-2">{root.icon}</span>}
                    {root.name}
                  </span>
                  <span className="tnum shrink-0 text-xs text-faint">
                    {num(totalFor(root.slug))}
                  </span>
                </Link>

                {children.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line-soft pt-3">
                    {children.map((c) => (
                      <Link
                        key={c.slug}
                        href={`/categories/${c.slug}`}
                        className="rounded-lg bg-raised px-2.5 py-1 text-xs text-muted transition-colors hover:text-brand"
                      >
                        {c.name}
                        <span className="tnum ml-1.5 text-faint">{num(c.count)}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {upcoming.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted">Pas encore alimentées</h2>
          <p className="mt-1 text-xs text-faint">
            Ces catégories se rempliront à mesure que des magasins seront ajoutés.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {upcoming.map((c) => (
              <span
                key={c.slug}
                className="rounded-lg border border-dashed border-line px-3 py-1.5 text-xs text-faint"
              >
                {c.icon && <span className="mr-1.5">{c.icon}</span>}
                {c.name}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
