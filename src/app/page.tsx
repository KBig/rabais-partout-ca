import Link from 'next/link';
import { topDeals, siteStats, activeStores, categoriesWithCounts } from '@/lib/db/queries';
import { DealGrid, EmptyState } from '@/components/DealCard';
import { num, timeAgo } from '@/lib/format';

// Les données changent à chaque crawl : aucune mise en cache statique.
export const dynamic = 'force-dynamic';

export default async function DiscoverPage() {
  const stats = siteStats();
  const stores = activeStores();
  const categories = categoriesWithCounts().filter((c) => !c.parentSlug && c.count > 0);

  // Trois sélections aux critères DIFFÉRENTS, pas trois tris du même classement.
  const lowestEver = topDeals({ limit: 10, minScore: 20, lowestEverOnly: true });
  const verified = topDeals({ limit: 10, minConfidence: 0.5, minScore: 30 });

  // Les articles boîte ouverte et remis à neuf ont leur propre section.
  //
  // Le filtre par défaut du site est « Neuf », choisi après un premier essai où
  // ils monopolisaient le classement. Mais cela les rendait TOTALEMENT
  // invisibles : 5 600 produits, dont de vraies bonnes affaires, qu'aucune page
  // n'affichait jamais. Une section séparée règle les deux problèmes — ils ne
  // noient plus le classement principal, et ils cessent d'être introuvables.
  const openBox = topDeals({ limit: 10, condition: 'used', minScore: 20 });
  const best = topDeals({ limit: 30 });

  if (stats.products === 0) {
    return (
      <EmptyState
        title="Aucun produit en base pour le moment."
        hint="Lancez un premier crawl : npm run crawl -- --store bestbuy-ca --deals"
      />
    );
  }

  return (
    <div className="space-y-14">
      <section>
        <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          Les vrais rabais,{' '}
          <span className="text-brand">vérifiés contre notre propre historique</span>.
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
          Un prix barré ne prouve rien. Chaque produit est comparé au prix qu&apos;il a réellement
          eu au fil du temps, et pondéré par la qualité mesurée des avis clients.
        </p>

        <dl className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Produits indexés" value={num(stats.products)} />
          <Stat label="Relevés de prix" value={num(stats.pricePoints)} />
          <Stat label="Au plus bas historique" value={num(stats.lowestEver)} accent />
          <Stat label="Dernière mise à jour" value={timeAgo(stats.lastCrawl)} />
        </dl>
      </section>

      {lowestEver.length > 0 && (
        <Section
          title="Au plus bas prix jamais observé"
          subtitle="Ces produits n'ont jamais été aussi peu chers depuis qu'on les suit."
        >
          <DealGrid deals={lowestEver} />
        </Section>
      )}

      {verified.length > 0 && (
        <Section
          title="Rabais confirmés"
          subtitle="Assez d'historique accumulé pour être sûr que la baisse est réelle."
        >
          <DealGrid deals={verified} />
        </Section>
      )}

      {openBox.length > 0 && (
        <Section
          title="Boîte ouverte et remis à neuf"
          subtitle="Comparés au prix du NEUF équivalent, moins l'écart habituel pour ce type d'article — pas entre eux."
        >
          <DealGrid deals={openBox} />
        </Section>
      )}

      <Section
        title="Meilleurs deals du moment"
        subtitle="Classés par score : rabais réel, qualité du produit et fiabilité du signal."
      >
        {best.length > 0 ? (
          <DealGrid deals={best} />
        ) : (
          <EmptyState title="Aucun deal ne dépasse le seuil pour l'instant." />
        )}
      </Section>

      {categories.length > 0 && (
        <Section title="Par catégorie">
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Link
                key={c.slug}
                href={`/categories/${c.slug}`}
                className="rounded-xl border border-line bg-surface px-3.5 py-2 text-sm text-muted transition-colors hover:border-brand/40 hover:text-text"
              >
                {c.icon && <span className="mr-1.5">{c.icon}</span>}
                {c.name}
                <span className="tnum ml-2 text-xs text-faint">{num(c.count)}</span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Magasins"
        subtitle="Un magasin est ajouté à la fois, avec son propre adaptateur."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {stores.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-card border border-line bg-surface p-3.5"
            >
              <span
                className="h-8 w-1.5 shrink-0 rounded-full"
                style={{ background: s.color ?? '#1e2637' }}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{s.name}</p>
                <p className="text-xs text-faint">
                  {s.products > 0 ? `${num(s.products)} produits` : 'bientôt disponible'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <dt className="text-[11px] uppercase tracking-wide text-faint">{label}</dt>
      <dd className={`tnum mt-1 text-xl font-bold ${accent ? 'text-brand' : 'text-text'}`}>
        {value}
      </dd>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
