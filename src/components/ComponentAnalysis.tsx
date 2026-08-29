import {
  GAMME_LABEL,
  type ComponentVerdict,
  type Gamme,
} from '@/lib/quality/components';
import { SPEC_GROUP_LABEL } from '@/lib/specs';

/**
 * ANALYSE COMPOSANTE PAR COMPOSANTE.
 *
 * Un prix ne dit pas si un appareil est bon. Ce qui le dit, c'est chacune de
 * ses pièces confrontée à ce que fait le marché : le processeur, la mémoire,
 * l'écran — ou, pour un réfrigérateur, le volume et le niveau sonore.
 *
 * Deux informations par ligne, et pas une de plus :
 *   CE QUE ÇA CHANGE, parce qu'un sigle ne sert à rien seul ;
 *   OÙ ÇA SE SITUE, avec la mesure qui a servi à le dire.
 *
 * La base du verdict est toujours affichée. Une étiquette « haut de gamme »
 * sans justification demanderait de nous croire sur parole ; avec la médiane
 * de la catégorie et le nombre de produits comparés, elle se vérifie.
 */

const TON: Record<Gamme, string> = {
  premium: 'bg-brand/15 text-brand',
  haut: 'bg-brand/10 text-brand/85',
  milieu: 'bg-raised text-muted',
  entree: 'bg-warm/15 text-warm',
};

export function GammeTag({ gamme }: { gamme: Gamme }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${TON[gamme]}`}
    >
      {GAMME_LABEL[gamme]}
    </span>
  );
}

export function ComponentAnalysis({ verdicts }: { verdicts: ComponentVerdict[] }) {
  const classes = verdicts.filter((v) => v.gamme);
  const dessus = classes.filter((v) => v.gamme === 'haut' || v.gamme === 'premium').length;
  const dessous = classes.filter((v) => v.gamme === 'entree').length;

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold tracking-tight">Analyse des composantes</h2>

      <p className="mb-4 max-w-3xl text-sm text-muted">
        {classes.length === 0 ? (
          <>
            Les caractéristiques annoncées ne permettent pas encore de situer ce produit
            face au marché.
          </>
        ) : (
          <>
            Chaque élément est comparé à ce que fait réellement sa catégorie.{' '}
            <strong className="text-text">
              {dessus} au-dessus, {dessous} en dessous
            </strong>{' '}
            sur {classes.length} élément{classes.length > 1 ? 's' : ''} mesuré
            {classes.length > 1 ? 's' : ''}.
          </>
        )}
      </p>

      <dl className="grid gap-3 sm:grid-cols-2">
        {verdicts.map(({ spec, gamme, basis }) => (
          <div key={spec.label} className="rounded-card border border-line bg-surface px-4 py-3">
            <dt className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-text">{spec.label}</span>
              {gamme ? (
                <GammeTag gamme={gamme} />
              ) : (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-faint">
                  {SPEC_GROUP_LABEL[spec.group]}
                </span>
              )}
            </dt>

            {/* L'important n'est pas la caractéristique, c'est ce qu'elle change. */}
            <dd className="mt-1 text-xs leading-relaxed text-muted">{spec.effect}</dd>

            {basis && (
              <dd className="mt-1.5 border-t border-line-soft pt-1.5 text-[11px] text-faint">
                {basis}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}
