import type { HistoryPoint } from '@/lib/db/queries';
import { money } from '@/lib/format';

/**
 * Historique de prix.
 *
 * Tracé EN ESCALIER, jamais en ligne droite. Un prix ne « glisse » pas de
 * 899 $ à 799 $ pendant trois jours : il tient à 899 $, puis change d'un coup.
 * Une ligne interpolée dessinerait des prix qui n'ont jamais existé, et
 * donnerait l'impression d'une baisse progressive là où il y a eu une bascule.
 *
 * C'est la version visuelle exacte du raisonnement de pricing/stats.ts.
 */
export function PriceChart({
  points,
  currentPrice,
  median,
  height = 200,
}: {
  points: HistoryPoint[];
  currentPrice: number;
  median?: number | null;
  height?: number;
}) {
  const now = Date.now();

  // Le dernier prix connu court jusqu'à maintenant : on ferme la série.
  const series = [
    ...points.map((p) => ({ t: Date.parse(p.observedAt), price: p.price })),
    { t: now, price: currentPrice },
  ].sort((a, b) => a.t - b.t);

  if (series.length < 2) {
    return (
      <div
        className="grid place-items-center rounded-card border border-dashed border-line text-xs text-faint"
        style={{ height }}
      >
        Historique trop court pour tracer une courbe. Revenez dans quelques jours.
      </div>
    );
  }

  const W = 800;
  const H = height;
  const PAD = { top: 16, right: 56, bottom: 22, left: 8 };

  const t0 = series[0].t;
  const t1 = Math.max(series[series.length - 1].t, t0 + 3600_000);
  const prices = series.map((s) => s.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  // Marge verticale pour qu'une série parfaitement plate ne colle pas au bord.
  const span = hi - lo || Math.max(1, hi * 0.1);
  const yLo = lo - span * 0.15;
  const yHi = hi + span * 0.15;

  const x = (t: number) =>
    PAD.left + ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (p: number) =>
    PAD.top + (1 - (p - yLo) / (yHi - yLo)) * (H - PAD.top - PAD.bottom);

  // Construction du tracé en escalier : horizontale, puis verticale.
  let d = `M ${x(series[0].t)} ${y(series[0].price)}`;
  for (let i = 1; i < series.length; i++) {
    d += ` L ${x(series[i].t)} ${y(series[i - 1].price)}`;
    d += ` L ${x(series[i].t)} ${y(series[i].price)}`;
  }

  const area = `${d} L ${x(series[series.length - 1].t)} ${H - PAD.bottom} L ${x(series[0].t)} ${H - PAD.bottom} Z`;

  const dateFmt = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short' });

  return (
    <figure className="rounded-card border border-line bg-surface p-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Historique de prix, de ${money(lo)} à ${money(hi)}`}
      >
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Repère du prix médian : la vraie référence pour juger d'un rabais. */}
        {median && median > yLo && median < yHi && (
          <g>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(median)}
              y2={y(median)}
              stroke="var(--color-muted)"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.5"
            />
            <text
              x={W - PAD.right + 6}
              y={y(median) + 3.5}
              fill="var(--color-muted)"
              fontSize="10"
            >
              médiane
            </text>
          </g>
        )}

        <path d={area} fill="url(#priceFill)" />
        <path
          d={d}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* Extrêmes annotés : le lecteur doit voir le plancher et le plafond. */}
        <text x={W - PAD.right + 6} y={y(hi) + 3.5} fill="var(--color-faint)" fontSize="10">
          {money(hi)}
        </text>
        <text x={W - PAD.right + 6} y={y(lo) + 3.5} fill="var(--color-faint)" fontSize="10">
          {money(lo)}
        </text>

        <circle cx={x(now)} cy={y(currentPrice)} r="4" fill="var(--color-brand)" />

        <text x={PAD.left} y={H - 6} fill="var(--color-faint)" fontSize="10">
          {dateFmt.format(t0)}
        </text>
        <text
          x={W - PAD.right}
          y={H - 6}
          textAnchor="end"
          fill="var(--color-faint)"
          fontSize="10"
        >
          aujourd&apos;hui
        </text>
      </svg>

      <figcaption className="mt-1 px-1 text-[11px] text-faint">
        {series.length - 1} changement{series.length > 2 ? 's' : ''} de prix relevé
        {series.length > 2 ? 's' : ''}. Le tracé est en escalier : un prix tient jusqu&apos;au
        changement suivant.
      </figcaption>
    </figure>
  );
}
