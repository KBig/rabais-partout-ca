/**
 * ÉTIQUETTE DE RABAIS.
 *
 * Deux dimensions, encodées séparément parce qu'elles ne disent pas la même
 * chose :
 *
 *   L'AMPLEUR donne la couleur — vert, puis jaune à 25 %, puis rouge à 50 %.
 *   Un coup d'œil suffit à trier une grille de vingt produits.
 *
 *   LA PREUVE donne la forme. Un rabais que NOUS avons vérifié (baisse réelle
 *   par rapport à la médiane observée) est plein. Un rabais simplement ANNONCÉ
 *   par le marchand est creux, en contour.
 *
 * Pourquoi cette distinction plutôt qu'une seule couleur : remplir de rouge un
 * « −70 % » que le marchand s'est attribué en gonflant son prix régulier
 * reviendrait à récompenser l'exagération, exactement ce que ce site existe
 * pour démasquer. La couleur reste lisible, la forme dit à quel point y croire.
 */

/** Seuils d'amplitude. Volontairement peu nombreux : trois paliers se lisent. */
const PALIERS = [
  { min: 0.5, ton: 'hot', libelle: 'exceptionnel' },
  { min: 0.25, ton: 'warm', libelle: 'très bon' },
  { min: 0.1, ton: 'brand', libelle: 'bon' },
  { min: 0, ton: 'faint', libelle: 'léger' },
] as const;

export type DiscountTon = (typeof PALIERS)[number]['ton'];

export function discountTier(fraction: number) {
  return PALIERS.find((p) => fraction >= p.min) ?? PALIERS[PALIERS.length - 1];
}

/*
 * Les classes sont écrites en toutes lettres : Tailwind analyse le source de
 * façon statique et ne verrait pas une classe assemblée à l'exécution.
 */
const PLEIN: Record<DiscountTon, string> = {
  hot: 'bg-hot/15 text-hot',
  warm: 'bg-warm/15 text-warm',
  brand: 'bg-brand/15 text-brand',
  faint: 'bg-raised text-muted',
};

const CONTOUR: Record<DiscountTon, string> = {
  hot: 'ring-1 ring-hot/35 text-hot/75',
  warm: 'ring-1 ring-warm/35 text-warm/75',
  brand: 'ring-1 ring-brand/35 text-brand/75',
  faint: 'ring-1 ring-line text-faint',
};

export function DiscountBadge({
  fraction,
  verified,
  size = 'sm',
}: {
  fraction: number;
  /** Vrai si la baisse est mesurée par nous, faux si seulement annoncée. */
  verified: boolean;
  size?: 'sm' | 'md';
}) {
  const { ton } = discountTier(fraction);
  const forme = verified ? PLEIN[ton] : CONTOUR[ton];
  const taille = size === 'md' ? 'px-2 py-1 text-xs' : 'px-1.5 py-0.5 text-[11px]';

  return (
    <span
      className={`tnum inline-flex items-center gap-1 rounded font-bold ${taille} ${forme}`}
      title={
        verified
          ? 'Baisse mesurée par rapport au prix habituellement observé.'
          : 'Rabais annoncé par le marchand : son « prix régulier » n’est pas vérifiable.'
      }
    >
      −{Math.round(fraction * 100)} %{!verified && <span className="font-medium">annoncé</span>}
    </span>
  );
}
