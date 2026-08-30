import Link from 'next/link';
import { search, topDeals, categoriesWithCounts, type DealFilters } from '@/lib/db/queries';
import { Suspense } from 'react';
import { SearchBar } from '@/components/SearchBar';
import { DealGrid, EmptyState } from '@/components/DealCard';
import { FilterGroup, SORT_OPTIONS, CONDITION_OPTIONS } from '@/components/FilterBar';
import { num } from '@/lib/format';

/**
 * PAGE MISE EN CACHE UNE MINUTE.
 *
 * `force-dynamic` recalculait tout a chaque affichage : rien n'etait garde,
 * pas meme entre deux clics sur le meme lien. Or les prix ne bougent qu'apres
 * une collecte, soit toutes les trois heures. Rendre la meme page quarante
 * fois par minute etait du travail refait pour un resultat identique.
 *
 * Soixante secondes est un compromis prudent : bien plus court que l'intervalle
 * de collecte — donc aucun risque d'afficher un prix perime — et bien plus long
 * qu'une session de navigation, ou l'on revient sans cesse sur les memes pages.
 */
export const revalidate = 60;

const PAGE_SIZE = 40;

/** Quelques pistes quand la page est ouverte sans requête. */
const SUGGESTIONS = [
  'téléviseur 65',
  'casque bluetooth',
  'portable gaming',
  'aspirateur robot',
  'moniteur 4k',
  'friteuse à air',
];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;

  // Adresse complete de la recherche : la fiche produit doit y ramener.
  const qsRetour = new URLSearchParams(
    Object.entries(sp).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  const retour = qsRetour ? `/recherche?${qsRetour}` : '/recherche';
  const q = (sp.q ?? '').trim();
  const sort = (sp.sort ?? 'pertinence') as string;
  // La recherche affiche TOUS les états par défaut, contrairement aux listings.
  //
  // Chercher est une intention explicite : on sait ce qu'on veut. Masquer
  // silencieusement les articles d'occasion faisait qu'un produit bel et bien
  // présent en base semblait introuvable. Sur les pages de découverte le
  // raisonnement est inverse — là, un défaut « Neuf » évite que l'occasion
  // monopolise le classement.
  const condition = (sp.condition ?? 'all') as 'new' | 'all' | 'used';
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const filters: DealFilters = {
    condition,
    sort: sort === 'pertinence' ? undefined : (sort as DealFilters['sort']),
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const result = q ? search(q, filters) : { rows: [], total: 0 };
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  // Sans requête, on montre quand même de la valeur plutôt qu'une page vide.
  const fallback = q ? [] : topDeals({ limit: 15 });
  const categories = categoriesWithCounts().filter((c) => !c.parentSlug && c.count > 0);

  return (
    <div className="space-y-7">
      <header className="mx-auto max-w-2xl pt-4 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Recherche</h1>
        <p className="mt-1.5 text-sm text-muted">
          Recherche insensible aux accents : « televiseur » trouve « téléviseur ».
        </p>
        <div className="mt-5">
          <Suspense
            fallback={<div className="h-12 rounded-xl border border-line bg-surface" />}
          >
            <SearchBar autoFocus={!q} />
          </Suspense>
        </div>

        {!q && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <Link
                key={s}
                href={`/recherche?q=${encodeURIComponent(s)}`}
                className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand"
              >
                {s}
              </Link>
            ))}
          </div>
        )}
      </header>

      {q ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-y border-line py-3">
            <p className="text-sm text-muted">
              <span className="tnum font-semibold text-text">{num(result.total)}</span> résultat
              {result.total > 1 ? 's' : ''} pour «&nbsp;<span className="text-text">{q}</span>&nbsp;»
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <FilterGroup
                label="Trier"
                param="sort"
                options={[{ label: 'Pertinence', value: 'pertinence' }, ...SORT_OPTIONS]}
                current={sort}
                basePath="/recherche"
                searchParams={sp}
              />
              <FilterGroup
                label="État"
                param="condition"
                options={CONDITION_OPTIONS}
                current={condition}
                basePath="/recherche"
                searchParams={sp}
              />
            </div>
          </div>

          {result.rows.length > 0 ? (
            <>
              <DealGrid deals={result.rows} retour={retour} />
              <Pagination page={page} pages={pages} searchParams={sp} />
            </>
          ) : (
            <EmptyState
              title={`Rien trouvé pour « ${q} ».`}
              hint="Essayez moins de mots, ou une marque seule. Le catalogue ne couvre que les catégories déjà parcourues."
            />
          )}
        </>
      ) : (
        <section>
          {categories.length > 0 && (
            <div className="mb-6 flex flex-wrap justify-center gap-2">
              {categories.map((c) => (
                <Link
                  key={c.slug}
                  href={`/categories/${c.slug}`}
                  className="rounded-lg bg-raised px-3 py-1.5 text-xs text-muted transition-colors hover:text-brand"
                >
                  {c.icon} {c.name}
                </Link>
              ))}
            </div>
          )}
          {fallback.length > 0 && (
            <>
              <h2 className="mb-4 text-sm font-semibold text-muted">
                En attendant, les meilleurs deals du moment
              </h2>
              <DealGrid deals={fallback} />
            </>
          )}
        </section>
      )}
    </div>
  );
}

function Pagination({
  page,
  pages,
  searchParams,
}: {
  page: number;
  pages: number;
  searchParams: Record<string, string | undefined>;
}) {
  if (pages <= 1) return null;

  const href = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v && k !== 'page') next.set(k, v);
    }
    if (p > 1) next.set('page', String(p));
    return `/recherche?${next.toString()}`;
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
