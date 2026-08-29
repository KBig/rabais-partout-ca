import type { HistoryPoint } from '@/lib/db/queries';
import { money } from '@/lib/format';

/**
 * Historique de prix.
 *
 * ----------------------------------------------------------------------------
 * TRACÉ EN ESCALIER, JAMAIS INTERPOLÉ
 * ----------------------------------------------------------------------------
 *
 * Un prix ne « glisse » pas de 899 $ à 799 $ pendant trois jours : il tient à
 * 899 $, puis change d'un coup. Une ligne droite entre deux relevés
 * dessinerait des prix qui n'ont jamais existé, et donnerait l'impression
 * d'une baisse progressive là où il y a eu une bascule.
 *
 * C'est la version visuelle exacte du raisonnement de pricing/stats.ts.
 *
 * ----------------------------------------------------------------------------
 * OÙ SONT LES EXTRÊMES
 * ----------------------------------------------------------------------------
 *
 * Savoir que le plus bas relevé est de 5 770,87 $ ne sert à rien si on ignore
 * QUAND. Le plancher et le plafond sont donc marqués sur la courbe elle-même,
 * datés, à l'endroit exact où ils se sont produits.
 *
 * ----------------------------------------------------------------------------
 * LES ÉTIQUETTES NE SE CHEVAUCHENT PLUS
 * ----------------------------------------------------------------------------
 *
 * Une version précédente écrivait la médiane, le maximum et le minimum à la
 * même abscisse, chacune à sa hauteur. Quand deux de ces valeurs coïncidaient
 * — cas fréquent : le prix actuel EST souvent la médiane — les textes se
 * superposaient caractère par caractère et devenaient illisibles.
 *
 * Les étiquettes de droite sont maintenant écartées les unes des autres avant
 * d'être tracées.
 */

/** Hauteur minimale entre deux étiquettes de droite, en unités du viewBox. */
const ECART_MIN = 13;

/**
 * Écarte verticalement des étiquettes qui se chevauchent.
 *
 * On les traite de haut en bas et on repousse celle qui empiète. Le décalage
 * reste minime : l'étiquette désigne toujours sa valeur sans ambiguïté, mais
 * ne recouvre plus sa voisine.
 */
function ecarter<T extends { y: number }>(items: T[], min: number, max: number): T[] {
  const tries = [...items].sort((a, b) => a.y - b.y);
  for (let i = 0; i < tries.length; i++) {
    tries[i].y = Math.max(tries[i].y, min);
    if (i > 0 && tries[i].y - tries[i - 1].y < ECART_MIN) {
      tries[i].y = tries[i - 1].y + ECART_MIN;
    }
  }
  // Si la pile déborde par le bas, on la remonte d'un bloc.
  const debord = tries.length ? tries[tries.length - 1].y - max : 0;
  if (debord > 0) for (const t of tries) t.y -= debord;
  return tries;
}

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
  const PAD = { top: 18, right: 92, bottom: 24, left: 10 };

  const t0 = series[0].t;
  const t1 = Math.max(series[series.length - 1].t, t0 + 3600_000);
  const prices = series.map((s) => s.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  // Marge verticale pour qu'une série parfaitement plate ne colle pas au bord.
  const span = hi - lo || Math.max(1, hi * 0.1);
  const yLo = lo - span * 0.18;
  const yHi = hi + span * 0.18;

  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + (1 - (p - yLo) / (yHi - yLo)) * (H - PAD.top - PAD.bottom);

  // Construction du tracé en escalier : horizontale, puis verticale.
  let d = `M ${x(series[0].t)} ${y(series[0].price)}`;
  for (let i = 1; i < series.length; i++) {
    d += ` L ${x(series[i].t)} ${y(series[i - 1].price)}`;
    d += ` L ${x(series[i].t)} ${y(series[i].price)}`;
  }
  const dernier = series[series.length - 1];
  const area = `${d} L ${x(dernier.t)} ${H - PAD.bottom} L ${x(series[0].t)} ${H - PAD.bottom} Z`;

  // PREMIÈRE occurrence de chaque extrême : c'est la date qui compte, et un
  // prix revenu au même niveau plus tard n'est pas un nouveau plancher.
  const pointBas = series.find((s) => s.price === lo)!;
  const pointHaut = series.find((s) => s.price === hi)!;

  const dateFmt = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short' });
  const jourFmt = new Intl.DateTimeFormat('fr-CA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Étiquettes de droite, écartées avant tracé.
  const etiquettes = ecarter(
    [
      { y: y(currentPrice), texte: money(currentPrice), couleur: 'var(--color-brand)', gras: true },
      ...(median && median > yLo && median < yHi && Math.abs(median - currentPrice) > span * 0.02
        ? [{ y: y(median), texte: `méd. ${money(median)}`, couleur: 'var(--color-muted)', gras: false }]
        : []),
    ],
    PAD.top + 4,
    H - PAD.bottom - 2,
  );

  /** Place une annotation à côté d'un point sans sortir du cadre. */
  const cote = (t: number) => (x(t) > W - PAD.right - 150 ? 'fin' : 'debut');

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
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(median)}
            y2={y(median)}
            stroke="var(--color-muted)"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.45"
          />
        )}

        <path d={area} fill="url(#priceFill)" />
        <path d={d} fill="none" stroke="var(--color-brand)" strokeWidth="2" strokeLinejoin="round" />

        {/*
          Les extrêmes sont marqués SUR la courbe, datés.
          Un chiffre sans sa date ne dit pas si le plancher remonte à hier ou à
          trois mois — or c'est toute la différence entre « c'est le moment » et
          « ça baisse régulièrement ».
        */}
        {hi > lo && (
          <g>
            <circle cx={x(pointHaut.t)} cy={y(hi)} r="3.5" fill="var(--color-faint)" />
            <text
              x={cote(pointHaut.t) === 'fin' ? x(pointHaut.t) - 8 : x(pointHaut.t) + 8}
              y={y(hi) - 7}
              textAnchor={cote(pointHaut.t) === 'fin' ? 'end' : 'start'}
              fill="var(--color-faint)"
              fontSize="10"
            >
              plus haut {money(hi)} · {jourFmt.format(pointHaut.t)}
            </text>

            <circle cx={x(pointBas.t)} cy={y(lo)} r="4" fill="var(--color-brand)" />
            <text
              x={cote(pointBas.t) === 'fin' ? x(pointBas.t) - 8 : x(pointBas.t) + 8}
              y={y(lo) + 15}
              textAnchor={cote(pointBas.t) === 'fin' ? 'end' : 'start'}
              fill="var(--color-brand)"
              fontSize="10"
              fontWeight="600"
            >
              plus bas {money(lo)} · {jourFmt.format(pointBas.t)}
            </text>
          </g>
        )}

        {/* Prix courant, toujours marqué au bout de la courbe. */}
        <circle cx={x(now)} cy={y(currentPrice)} r="4" fill="var(--color-brand)" />
        <circle
          cx={x(now)}
          cy={y(currentPrice)}
          r="7"
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="1"
          opacity="0.35"
        />

        {etiquettes.map((e) => (
          <text
            key={e.texte}
            x={W - PAD.right + 8}
            y={e.y + 3.5}
            fill={e.couleur}
            fontSize="10"
            fontWeight={e.gras ? 700 : 400}
          >
            {e.texte}
          </text>
        ))}

        <text x={PAD.left} y={H - 7} fill="var(--color-faint)" fontSize="10">
          {dateFmt.format(t0)}
        </text>
        <text
          x={W - PAD.right}
          y={H - 7}
          textAnchor="end"
          fill="var(--color-faint)"
          fontSize="10"
        >
          aujourd&apos;hui
        </text>
      </svg>

      <figcaption className="mt-1 px-1 text-[11px] text-faint">
        {series.length - 1} changement{series.length > 2 ? 's' : ''} de prix relevé
        {series.length > 2 ? 's' : ''} depuis le {dateFmt.format(t0)}. Le tracé est en escalier :
        un prix tient jusqu&apos;au changement suivant.
      </figcaption>
    </figure>
  );
}
