import Link from 'next/link';

/**
 * Barre de filtres.
 *
 * Volontairement rendue en liens serveur plutôt qu'en état React : chaque
 * filtre est une URL. C'est partageable, ça fonctionne sans JavaScript, et le
 * bouton « précédent » du navigateur se comporte comme l'utilisateur l'attend.
 */

export interface FilterOption {
  label: string;
  value: string;
}

export function FilterGroup({
  label,
  param,
  options,
  current,
  basePath,
  searchParams,
}: {
  label: string;
  param: string;
  options: FilterOption[];
  current: string;
  basePath: string;
  searchParams: Record<string, string | undefined>;
}) {
  const buildHref = (value: string) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v && k !== param) next.set(k, v);
    }
    // La valeur par défaut n'est pas écrite dans l'URL : on garde des liens propres.
    if (value !== options[0].value) next.set(param, value);
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] uppercase tracking-wide text-faint">{label}</span>
      {options.map((o) => {
        const active = o.value === current;
        return (
          <Link
            key={o.value}
            href={buildHref(o.value)}
            className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
              active
                ? 'bg-brand/15 font-medium text-brand'
                : 'bg-raised text-muted hover:text-text'
            }`}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

export const SORT_OPTIONS: FilterOption[] = [
  { label: 'Meilleur score', value: 'score' },
  { label: 'Plus forte baisse', value: 'drop' },
  { label: 'Prix croissant', value: 'price-asc' },
  { label: 'Prix décroissant', value: 'price-desc' },
];

export const CONDITION_OPTIONS: FilterOption[] = [
  { label: 'Neuf', value: 'new' },
  { label: 'Occasion', value: 'used' },
  { label: 'Tout inclure', value: 'all' },
];
