/**
 * « Ce processus existe-t-il encore ? »
 *
 * Isole dans son propre fichier a dessein : la reponse ne depend ni de la base
 * ni du reseau, et les tests de non-regression doivent pouvoir l'interroger
 * sans ouvrir SQLite.
 */

/**
 * Le signal 0 ne transmet rien. Il demande seulement au noyau si la cible est
 * joignable, et trois reponses sont possibles — les trois comptent :
 *
 *   (aucune erreur)  le processus existe et nous appartient.        VIVANT
 *   EPERM            il existe, mais appartient a quelqu'un d'autre. VIVANT
 *   ESRCH            personne a cette adresse.                       MORT
 *
 * Traiter EPERM comme « mort » libererait le verrou d'une collecte en train de
 * travailler — precisement ce que le verrou existe pour empecher. C'est le
 * piege classique de cette verification, et il ne se voit pas en developpement
 * ou tous les processus appartiennent au meme utilisateur.
 */
export function processusVivant(pid: number): boolean {
  // Un identifiant absurde ne merite pas d'appel systeme : `process.kill(0)`
  // vise le groupe de processus courant sous POSIX et repondrait « vivant ».
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
