import Link from 'next/link';
import type { CategoryFacets, FacetValue } from '@/lib/db/queries';
import { num } from '@/lib/format';

/**
 * PANNEAU DE FILTRES.
 *
 * Rendu en liens serveur, comme le reste du site. Chaque combinaison de
 * filtres est une URL : elle se partage, elle survit au rechargement, elle
 * fonctionne sans JavaScript, et le bouton « précédent » du navigateur revient
 * exactement à la sélection précédente — ce que ne fait aucun panneau tenu en
 * état React.
 *
 * Les critères proposés ne sont pas écrits à la main : ils sortent du contenu
 * réel du rayon. Un rayon d'ordinateurs propose le processeur et la mémoire,
 * un rayon de réfrigérateurs propose la capacité et le niveau sonore. Une
 * liste figée serait fausse dès le rayon suivant.
 */

export const FACET_PREFIX = 'f_';

/** Nombre de criteres deplies au chargement, les plus decisifs d'abord. */
const OUVERTS_PAR_DEFAUT = 3;

type Params = Record<string, string | undefined>;

/** Valeurs cochées d'un paramètre multiple. */
export function parseList(v: string | undefined): string[] {
  return v ? v.split(',').filter(Boolean) : [];
}

/** Ajoute ou retire une valeur, et renvoie l'URL correspondante. */
function toggleHref(
  basePath: string,
  params: Params,
  key: string,
  value: string,
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    // Changer un filtre renvoie toujours à la première page : rester en page 7
    // d'une sélection qui n'en compte plus que deux afficherait du vide.
    if (v && k !== key && k !== 'page') next.set(k, v);
  }

  const actuelles = parseList(params[key]);
  const suivantes = actuelles.includes(value)
    ? actuelles.filter((x) => x !== value)
    : [...actuelles, value];

  if (suivantes.length) next.set(key, suivantes.join(','));
  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function Choix({
  v,
  actif,
  href,
}: {
  v: FacetValue;
  actif: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs transition-colors ${
        actif ? 'bg-brand/15 font-medium text-brand' : 'text-muted hover:bg-raised hover:text-text'
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className={`grid h-3 w-3 shrink-0 place-items-center rounded-[3px] border ${
            actif ? 'border-brand bg-brand' : 'border-line'
          }`}
        >
          {actif && (
            <svg viewBox="0 0 10 10" className="h-2 w-2 text-ink" aria-hidden>
              <path d="M1 5l2.5 2.5L9 2" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          )}
        </span>
        <span className="truncate">{v.label}</span>
      </span>
      <span className="tnum shrink-0 text-[10px] text-faint">{num(v.count)}</span>
    </Link>
  );
}

function Bloc({
  titre,
  children,
  ouvert,
}: {
  titre: string;
  children: React.ReactNode;
  ouvert: boolean;
}) {
  return (
    <details open={ouvert} className="border-b border-line-soft pb-2.5">
      <summary className="cursor-pointer list-none py-2 text-[11px] font-semibold uppercase tracking-wide text-faint hover:text-muted">
        {titre}
      </summary>
      <div className="mt-0.5 space-y-0.5">{children}</div>
    </details>
  );
}

export function FacetPanel({
  facets,
  basePath,
  searchParams,
}: {
  facets: CategoryFacets;
  basePath: string;
  searchParams: Params;
}) {
  const marques = parseList(searchParams.brand);
  const vendeurs = parseList(searchParams.seller);
  const enseignes = parseList(searchParams.store);

  const nbActifs =
    marques.length +
    vendeurs.length +
    enseignes.length +
    Object.entries(searchParams).filter(
      ([k, v]) => k.startsWith(FACET_PREFIX) && v,
    ).length +
    (searchParams.pmin ? 1 : 0) +
    (searchParams.pmax ? 1 : 0);

  // Tout effacer sauf ce qui n'est pas un filtre : le tri et l'état restent.
  const hrefVierge = (() => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      const estFiltre =
        k.startsWith(FACET_PREFIX) ||
        ['brand', 'seller', 'store', 'pmin', 'pmax', 'page'].includes(k);
      if (v && !estFiltre) next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  })();

  return (
    <aside className="lg:sticky lg:top-4 lg:self-start">
      <details open className="lg:open">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg border border-line px-3 py-2 text-sm font-medium lg:hidden">
          <span>Filtres{nbActifs > 0 && ` (${nbActifs})`}</span>
          <span className="text-faint">▾</span>
        </summary>

        <div className="mt-3 lg:mt-0">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Filtres</h2>
            {nbActifs > 0 && (
              <Link href={hrefVierge} className="text-[11px] text-muted hover:text-brand">
                Tout effacer
              </Link>
            )}
          </div>

          {/*
            Le prix passe par un formulaire GET plutôt que par des tranches
            prédéfinies : « entre 800 et 1 200 » est une demande précise, et
            aucune tranche écrite à l'avance ne tombe jamais juste.
          */}
          <form action={basePath} method="get" className="mt-3">
            {Object.entries(searchParams).map(([k, v]) =>
              v && k !== 'pmin' && k !== 'pmax' && k !== 'page' ? (
                <input key={k} type="hidden" name={k} value={v} />
              ) : null,
            )}
            <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
              Prix
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <input
                type="number"
                name="pmin"
                min={0}
                placeholder={String(facets.priceMin)}
                defaultValue={searchParams.pmin ?? ''}
                className="tnum w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-text placeholder:text-faint focus:border-brand focus:outline-none"
              />
              <span className="text-faint">–</span>
              <input
                type="number"
                name="pmax"
                min={0}
                placeholder={String(facets.priceMax)}
                defaultValue={searchParams.pmax ?? ''}
                className="tnum w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-text placeholder:text-faint focus:border-brand focus:outline-none"
              />
              <button
                type="submit"
                className="shrink-0 rounded-md bg-raised px-2 py-1 text-xs text-muted transition-colors hover:text-brand"
              >
                OK
              </button>
            </div>
          </form>

          <div className="mt-3">
            {/*
              Le magasin passe en premier : « je vais chez Canac cet
              apres-midi » est une contrainte plus forte qu'une marque ou une
              caracteristique. Masque quand une seule enseigne est presente —
              un filtre a une seule valeur ne filtre rien.
            */}
            {facets.storeFacets.length > 1 && (
              <Bloc titre="Magasin" ouvert>
                {facets.storeFacets.map((m) => (
                  <Choix
                    key={m.value}
                    v={m}
                    actif={enseignes.includes(m.value)}
                    href={toggleHref(basePath, searchParams, 'store', m.value)}
                  />
                ))}
              </Bloc>
            )}

            {facets.brands.length > 1 && (
              <Bloc titre="Marque" ouvert={marques.length > 0}>
                {facets.brands.map((b) => (
                  <Choix
                    key={b.value}
                    v={b}
                    actif={marques.includes(b.value)}
                    href={toggleHref(basePath, searchParams, 'brand', b.value)}
                  />
                ))}
              </Bloc>
            )}

            {/*
              Les premiers criteres sont deplies d'office. FAMILY_ORDER les
              classe deja par pouvoir de decision : un panneau entierement
              replie oblige a cliquer partout pour decouvrir ce qu'il propose,
              ce qui revient a le cacher.
            */}
            {facets.specs.map((f, i) => {
              const cle = `${FACET_PREFIX}${f.family}`;
              const choisies = parseList(searchParams[cle]);
              return (
                <Bloc
                  key={f.family}
                  titre={f.label}
                  ouvert={choisies.length > 0 || i < OUVERTS_PAR_DEFAUT}
                >
                  {f.values.map((v) => (
                    <Choix
                      key={v.value}
                      v={v}
                      actif={choisies.includes(v.value)}
                      href={toggleHref(basePath, searchParams, cle, v.value)}
                    />
                  ))}
                </Bloc>
              );
            })}

            {facets.sellers.length > 1 && (
              <Bloc titre="Vendeur" ouvert={vendeurs.length > 0}>
                {facets.sellers.map((v) => (
                  <Choix
                    key={v.value}
                    v={v}
                    actif={vendeurs.includes(v.value)}
                    href={toggleHref(basePath, searchParams, 'seller', v.value)}
                  />
                ))}
              </Bloc>
            )}
          </div>
        </div>
      </details>
    </aside>
  );
}

/** Traduit les paramètres d'URL en filtres de requête. */
export function filtersFromParams(params: Params) {
  const specs: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!k.startsWith(FACET_PREFIX) || !v) continue;
    const valeurs = parseList(v);
    if (valeurs.length) specs[k.slice(FACET_PREFIX.length)] = valeurs;
  }

  const nombre = (v: string | undefined) => {
    const n = Number(v);
    return v && Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  return {
    brands: parseList(params.brand),
    sellers: parseList(params.seller),
    stores: parseList(params.store),
    specs,
    minPrice: nombre(params.pmin),
    maxPrice: nombre(params.pmax),
  };
}
