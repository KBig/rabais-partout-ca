/** Helpers de formatage, en français canadien (1 299,99 $). */

const MONEY = new Intl.NumberFormat('fr-CA', {
  style: 'currency',
  currency: 'CAD',
  minimumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat('fr-CA');

export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : MONEY.format(n);

export const num = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : NUM.format(n);

export const pct = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined ? '—' : `${(n * 100).toFixed(digits)} %`;

/** « il y a 3 heures », « il y a 2 jours ». */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'jamais';
  const diff = Date.now() - Date.parse(iso);
  const min = Math.round(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return `il y a ${Math.round(d / 30)} mois`;
}

/** Palette du score : du gris (faible) au vert (excellent). */
export function scoreTone(score: number): {
  ring: string;
  text: string;
  bg: string;
  label: string;
} {
  if (score >= 65)
    return {
      ring: 'ring-brand/60',
      text: 'text-brand',
      bg: 'bg-brand/12',
      label: 'Excellent',
    };
  if (score >= 45)
    return {
      ring: 'ring-warm/50',
      text: 'text-warm',
      bg: 'bg-warm/12',
      label: 'Bon',
    };
  if (score >= 25)
    return {
      ring: 'ring-line',
      text: 'text-muted',
      bg: 'bg-raised',
      label: 'Correct',
    };
  return { ring: 'ring-line-soft', text: 'text-faint', bg: 'bg-raised', label: 'Faible' };
}

export const CONDITION_LABEL: Record<string, string> = {
  new: 'Neuf',
  'open-box': 'Boîte ouverte',
  refurbished: 'Remis à neuf',
};
