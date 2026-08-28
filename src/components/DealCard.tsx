import Link from 'next/link';
import type { DealRow } from '@/lib/db/queries';
import { money, CONDITION_LABEL } from '@/lib/format';
import { ScoreBadge } from './ScoreBadge';
import { ProductImage } from './ProductImage';

/**
 * Carte produit.
 *
 * Choix d'affichage important : on montre la baisse par rapport à NOTRE
 * médiane, pas le « -60 % » du marchand. Quand les deux divergent, c'est
 * précisément le cas où le marchand exagère — et c'est là que le site apporte
 * sa valeur.
 */
export function DealCard({ deal, priority = false }: { deal: DealRow; priority?: boolean }) {
  const drop = deal.dropVsMedian ?? 0;
  const realDrop = drop >= 0.03 ? drop : null;
  const claimed =
    deal.listPrice && deal.listPrice > deal.price
      ? (deal.listPrice - deal.price) / deal.listPrice
      : null;

  return (
    <Link
      href={`/produit/${deal.id}`}
      className="group flex flex-col overflow-hidden rounded-card border border-line bg-surface transition-all hover:border-line/80 hover:bg-raised"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-white/[0.03]">
        <ProductImage
          src={deal.imageUrl}
          targetWidth={400}
          priority={priority}
          alt={deal.title}
          brand={deal.brand}
          className="h-full w-full object-contain p-4 transition-transform duration-300 group-hover:scale-[1.04]"
        />

        <div className="absolute left-2.5 top-2.5 flex flex-col items-start gap-1.5">
          {deal.isLowestEver === 1 && (
            <span className="rounded-md bg-brand px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">
              Plus bas jamais vu
            </span>
          )}
          {deal.condition !== 'new' && (
            <span className="rounded-md bg-ink/85 px-2 py-0.5 text-[10px] font-semibold text-warm backdrop-blur">
              {CONDITION_LABEL[deal.condition] ?? deal.condition}
            </span>
          )}
          {/*
            Un vendeur tiers doit se voir AVANT le clic : politique de retour,
            delais et service apres-vente different de ceux du detaillant.
            Comparer deux prix sans le savoir revient a comparer deux choses
            differentes.
          */}
          {deal.marketplace === 1 && (
            <span className="rounded-md bg-ink/85 px-2 py-0.5 text-[10px] font-semibold text-muted backdrop-blur">
              Vendeur tiers
            </span>
          )}
        </div>

        <span
          className="absolute right-2.5 top-2.5 rounded-md px-2 py-0.5 text-[10px] font-semibold backdrop-blur"
          style={{
            background: `${deal.storeColor ?? '#1e2637'}dd`,
            color: '#fff',
          }}
        >
          {deal.storeName}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {deal.brand && (
              <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                {deal.brand}
              </p>
            )}
            <h3 className="mt-0.5 line-clamp-2 text-[13px] font-medium leading-snug text-text">
              {deal.title}
            </h3>
          </div>
          <ScoreBadge score={deal.score} confidence={deal.confidence} size="sm" />
        </div>

        <div className="mt-auto">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="tnum text-lg font-bold text-text">{money(deal.price)}</span>
            {deal.median && deal.median > deal.price * 1.02 && (
              <span className="tnum text-xs text-faint line-through">{money(deal.median)}</span>
            )}
            {realDrop ? (
              <span className="tnum rounded bg-brand/15 px-1.5 py-0.5 text-[11px] font-bold text-brand">
                −{Math.round(realDrop * 100)} %
              </span>
            ) : claimed ? (
              <span className="tnum rounded bg-raised px-1.5 py-0.5 text-[11px] font-medium text-faint">
                −{Math.round(claimed * 100)} % annoncé
              </span>
            ) : null}
          </div>

          {deal.reasons.length > 0 && (
            <p className="mt-1.5 line-clamp-1 text-[11px] text-muted">{deal.reasons[0]}</p>
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * Grille réutilisée par toutes les pages de listing.
 *
 * Les premières vignettes sont chargées en priorité : ce sont celles que
 * l'utilisateur voit avant tout défilement. Les suivantes restent différées.
 */
const EAGER_COUNT = 10;

export function DealGrid({ deals }: { deals: DealRow[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {deals.map((d, i) => (
        <DealCard key={d.id} deal={d} priority={i < EAGER_COUNT} />
      ))}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-16 text-center">
      <p className="text-sm font-medium text-muted">{title}</p>
      {hint && <p className="mt-2 text-xs text-faint">{hint}</p>}
    </div>
  );
}
