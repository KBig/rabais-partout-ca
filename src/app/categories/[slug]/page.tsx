import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  topDeals,
  countDeals,
  categoriesWithCounts,
  categoryFacets,
  type DealFilters,
} from '@/lib/db/queries';
import { CATEGORY_BY_SLUG, childrenOf } from '@/lib/categories';
import { DealGrid, EmptyState } from '@/components/DealCard';
import { FilterGroup, SORT_OPTIONS, CONDITION_OPTIONS } from '@/components/FilterBar';
import { FacetPanel, filtersFromParams } from '@/components/FacetPanel';
import { num } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 40;

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const category = CATEGORY_BY_SLUG.get(slug);
  if (!category) notFound();

  const sort = (sp.sort ?? 'score') as NonNullable<DealFilters['sort']>;
  const condition = (sp.condition ?? 'new') as 'new' | 'all' | 'used';
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const choisis = filtersFromParams(sp);

  const filters: DealFilters = {
    category: slug,
    sort,
    condition,
    ...choisis,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const deals = topDeals(filters);
  // Le compteur applique EXACTEMENT les memes filtres que la liste, sans quoi
  // la pagination annonce des pages qui n'existent pas.
  const total = countDeals(filters);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const facets = categoryFacets({ category: slug, condition, ...choisis });

  const counts = categoriesWithCounts();
  const siblings = childrenOf(slug)
    .map((c) => ({ ...c, count: counts.find((x) => x.slug === c.slug)?.count ?? 0 }))
    .filter((c) => c.count > 0);

  const parent = category.parent ? CATEGORY_BY_SLUG.get(category.parent) : null;
  const basePath = `/categories/${slug}`;

  return (
    <div className="space-y-6">
      <header>
        <nav className="flex items-center gap-1.5 text-xs text-faint">
          <Link href="/categories" className="hover:text-muted">
            Catégories
          </Link>
          {parent && (
            <>
              <span>/</span>
              <Link href={`/categories/${parent.slug}`} className="hover:text-muted">
                {parent.name}
              </Link>
            </>
          )}
        </nav>

        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          {category.icon && <span className="mr-2">{category.icon}</span>}
          {category.name}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {num(total)} produit{total > 1 ? 's' : ''} indexé{total > 1 ? 's' : ''} et suivi
          {total > 1 ? 's' : ''}
        </p>
      </header>

      {siblings.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {siblings.map((c) => (
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

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-line py-3">
        <FilterGroup
          label="Trier"
          param="sort"
          options={SORT_OPTIONS}
          current={sort}
          basePath={basePath}
          searchParams={sp}
        />
        <FilterGroup
          label="État"
          param="condition"
          options={CONDITION_OPTIONS}
          current={condition}
          basePath={basePath}
          searchParams={sp}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <FacetPanel facets={facets} basePath={basePath} searchParams={sp} />

        <div className="min-w-0 space-y-6">
          {deals.length > 0 ? (
            <>
              <DealGrid deals={deals} />
              <Pagination page={page} pages={pages} basePath={basePath} searchParams={sp} />
            </>
          ) : (
            <EmptyState
              title="Aucun produit ne correspond à ces filtres."
              hint="Retirez un critère pour élargir la sélection."
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Pagination({
  page,
  pages,
  basePath,
  searchParams,
}: {
  page: number;
  pages: number;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  if (pages <= 1) return null;

  const href = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v && k !== 'page') next.set(k, v);
    }
    if (p > 1) next.set('page', String(p));
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <nav className="flex items-center justify-center gap-3 pt-4">
      {page > 1 && (
        <Link
          href={href(page - 1)}
          className="rounded-lg border border-line px-3.5 py-1.5 text-sm text-muted hover:text-text"
        >
          Précédent
        </Link>
      )}
      <span className="tnum text-sm text-faint">
        Page {page} sur {pages}
      </span>
      {page < pages && (
        <Link
          href={href(page + 1)}
          className="rounded-lg border border-line px-3.5 py-1.5 text-sm text-muted hover:text-text"
        >
          Suivant
        </Link>
      )}
    </nav>
  );
}
