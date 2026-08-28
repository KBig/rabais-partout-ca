import { scoreTone } from '@/lib/format';

/**
 * Pastille de score.
 *
 * Elle affiche DEUX informations, jamais une seule : la note et la confiance.
 * Montrer « 82/100 » sans dire qu'on ne dispose que de 2 jours d'historique
 * serait mensonger — l'anneau de confiance est donc dessiné autour du chiffre,
 * pas relégué ailleurs sur la page.
 */
export function ScoreBadge({
  score,
  confidence,
  size = 'md',
}: {
  score: number;
  confidence: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  const tone = scoreTone(score);
  const dim = size === 'lg' ? 64 : size === 'sm' ? 40 : 52;
  const stroke = size === 'lg' ? 5 : 4;
  const r = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <div className="relative shrink-0" style={{ width: dim, height: dim }}>
      <svg width={dim} height={dim} className="-rotate-90">
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={r}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={stroke}
        />
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.max(0.02, confidence))}
          className={tone.text}
          opacity={0.9}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span
          className={`tnum font-bold leading-none ${tone.text} ${
            size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-[13px]' : 'text-base'
          }`}
        >
          {Math.round(score)}
        </span>
      </div>
    </div>
  );
}

/** Version textuelle, pour les endroits où l'anneau serait trop discret. */
export function ConfidenceLabel({ confidence }: { confidence: number }) {
  const level =
    confidence >= 0.7
      ? { text: 'Confiance élevée', cls: 'text-brand' }
      : confidence >= 0.4
        ? { text: 'Confiance moyenne', cls: 'text-warm' }
        : { text: 'Signal à confirmer', cls: 'text-faint' };

  return (
    <span className={`text-[11px] font-medium ${level.cls}`}>
      {level.text} · {Math.round(confidence * 100)} %
    </span>
  );
}
