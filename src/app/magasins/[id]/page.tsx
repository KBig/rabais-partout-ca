import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  topDeals,
  countDeals,
  categoryFacets,
  activeStores,
  categoriesWithCounts,
  type DealFilters,
} from '@/lib/db/queries';
import { CATEGORY_BY_SLUG } from '@/lib/categories';
import { DealGrid, EmptyState } from '@/components/DealCard';
import { FilterGroup, SORT_OPTIONS, CONDITION_OPTIONS } from '@/components/FilterBar';
import { FacetPanel, filtersFromParams } from '@/components/FacetPanel';
import { num } from '@/lib/format';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 40;

/**
 * Les rabais d'UNE enseigne.
 *
 * Même moteur, mêmes filtres et même tri que la page de rayon : seule la
 * contrainte de départ change. Le panneau latéral masque son propre filtre
 * « Magasin » ici, puisqu'il serait à une seule valeur — un filtre qui ne
 * filtre rien encombre sans servir.
 */
export default async function MagasinPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const store = activeStores().find((s) => s.id === id);
  if (!store) notFound();

  const sort = (sp.sort ?? 'score') as NonNullable<DealFilters['sort']>;
  const condition = (sp.condition ?? 'new') as 'new' | 'all' | 'used';
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const choisis = filtersFromParams(sp);

  const filters: DealFilters = {
    store: id,
    sort,
    condition,
    ...choisis,
    // Le magasin est fixe par la page : le filtre multiple n'a pas cours ici.
    stores: undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const deals = topDeals(filters);
  const total = countDeals(filters);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const facets = categoryFacets(filters);

  const basePath = `/magasins/${id}`;
  const qs = new URLSearchParams(
    Object.entries(sp).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  const retour = qs ? `${basePath}?${qs}` : basePath;

  // Rayons de CE magasin, pour entrer directement dans ce qu'il vend.
  const rayons = categoriesWithCounts(id)
    .filter((c) => c.count > 0)
    .slice(0, 14);

  return (
    <div className="space-y-6">
      <header>
        <nav className="flex items-center gap-1.5 text-xs text-faint">
          <Link href="/magasins" className="hover:text-muted">
            Magasins
          </Link>
        </nav>

        <div className="mt-2 flex items-center gap-3">
          <span
            className="h-9 w-1.5 shrink-0 rounded-full"
            style={{ background: store.color ?? '#1e2637' }}
          />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{store.name}</h1>
            <p className="tnum mt-0.5 text-sm text-muted">
              {num(total)} produit{total > 1 ? 's' : ''} suivi{total > 1 ? 's' : ''}
              {' · '}
              <a
                href={store.homepage}
                target="_blank"
                rel="noreferrer nofollow"
                className="underline decoration-line underline-offset-2 hover:text-text"
              >
                site du marchand
              </a>
            </p>
          </div>
        </div>
      </header>

      {rayons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rayons.map((c) => (
            <Link
              key={c.slug}
              href={`/categories/${c.slug}?store=${id}`}
              className="rounded-lg bg-raised px-2.5 py-1 text-xs text-muted transition-colors hover:text-brand"
            >
              {CATEGORY_BY_SLUG.get(c.slug)?.name ?? c.slug}
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
        <FacetPanel
          facets={{ ...facets, storeFacets: [] }}
          basePath={basePath}
          searchParams={sp}
        />

        <div className="min-w-0 space-y-6">
          {deals.length > 0 ? (
            <>
              <DealGrid deals={deals} retour={retour} />
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
