/**
 * FILE DE TRAVAIL CONTINUE.
 *
 * Le limiteur de débit espace le DÉPART des requêtes ; rien n'oblige à attendre
 * la fin de l'une avant de lancer la suivante. En séquentiel, une réponse de
 * 300 ms plafonne la collecte à trois par seconde quelle que soit la cadence
 * autorisée — le réseau attend, et nous avec.
 *
 * Deux formes existaient dans le projet, écrites deux fois. Celle-ci les
 * remplace :
 *
 *   Les VAGUES — lancer N, attendre les N, recommencer — ont l'air simples mais
 *   chaque tour dure celui du plus lent, et les autres lignes ne font rien.
 *   Mesuré sur Costco : aucun gain par rapport au séquentiel.
 *
 *   La FILE CONTINUE relance dès qu'une place se libère. C'est la cadence
 *   déclarée qui redevient la seule limite, ce qu'on veut.
 *
 * Les résultats sont rendus DANS L'ORDRE D'ARRIVÉE, pas dans celui de la
 * liste : attendre l'ordre d'origine reviendrait à refaire des vagues.
 */
export async function* enParallele<T, R>(
  items: readonly T[],
  largeur: number,
  travail: (item: T, index: number) => Promise<R>,
  arrete?: () => boolean,
): AsyncGenerator<R> {
  const enCours = new Map<number, Promise<{ i: number; valeur: R }>>();
  let suivant = 0;

  const remplir = () => {
    while (enCours.size < largeur && suivant < items.length) {
      if (arrete?.()) return;
      const i = suivant++;
      enCours.set(
        i,
        travail(items[i], i).then((valeur) => ({ i, valeur })),
      );
    }
  };

  remplir();

  while (enCours.size > 0) {
    const { i, valeur } = await Promise.race(enCours.values());
    enCours.delete(i);
    if (!arrete?.()) remplir();
    yield valeur;
  }
}
