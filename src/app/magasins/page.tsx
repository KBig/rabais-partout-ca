import Link from 'next/link';
import { activeStores } from '@/lib/db/queries';
import { num } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Magasins — Item Finder',
  description: 'Parcourir les rabais enseigne par enseigne.',
};

/**
 * NAVIGATION PAR MAGASIN.
 *
 * « Je passe chez Canac cet après-midi, montre-moi seulement leurs rabais. »
 * C'est une contrainte de la vie réelle, plus forte qu'une marque ou une
 * caractéristique : on ne fait pas trois magasins pour économiser douze
 * dollars.
 *
 * Cette page est la porte d'entrée ; le filtre « Magasin » du panneau latéral
 * sert au cas inverse, quand on part d'un rayon et qu'on veut restreindre.
 */
export default async function MagasinsPage() {
  const stores = activeStores();
  const collectes = stores.filter((s) => s.products > 0);
  const attendus = stores.filter((s) => s.products === 0 && !s.blocked);
  const refuses = stores.filter((s) => s.products === 0 && s.blocked);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Magasins</h1>
        <p className="mt-1 text-sm text-muted">
          Parcourir les rabais d&apos;une seule enseigne, ou comparer un même
          modèle entre plusieurs.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-faint">
          Suivis en ce moment
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {collectes.map((s) => (
            <Link
              key={s.id}
              href={`/magasins/${s.id}`}
              className="group flex items-center gap-3 rounded-card border border-line bg-surface p-4 transition-colors hover:border-line/80 hover:bg-raised"
            >
              <span
                className="h-10 w-1.5 shrink-0 rounded-full"
                style={{ background: s.color ?? '#1e2637' }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold group-hover:text-brand">
                  {s.name}
                </p>
                <p className="tnum text-xs text-muted">{num(s.products)} produits suivis</p>
              </div>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
                aria-hidden
              >
                <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          ))}
        </div>
      </section>

      {attendus.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-faint">
            À venir
          </h2>
          <div className="flex flex-wrap gap-2">
            {attendus.map((s) => (
              <span
                key={s.id}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted"
              >
                {s.name}
                {s.ready && <span className="ml-1.5 text-faint">collecte à lancer</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      {refuses.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-faint">
            Accès refusé par le marchand
          </h2>
          {/*
            Ces enseignes ne sont pas « en retard » : elles refusent la collecte
            automatisée, et ce refus se respecte. Le dire évite de laisser
            croire à un travail en cours qui n'arrivera jamais.
          */}
          <div className="grid gap-2 sm:grid-cols-2">
            {refuses.map((s) => (
              <div
                key={s.id}
                className="rounded-card border border-dashed border-line px-3.5 py-2.5"
              >
                <p className="text-xs font-medium text-muted">{s.name}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-faint">{s.blocked}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
