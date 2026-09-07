import type { NextConfig } from 'next';

const config: NextConfig = {
  // better-sqlite3 est un module natif : il doit rester externe au bundle
  // serveur, sinon Next tente de le compiler et échoue.
  serverExternalPackages: ['better-sqlite3'],

  experimental: {
    // Restaure la position de défilement lors d'un retour arrière.
    scrollRestoration: true,

    /**
     * Désactive le cache de navigation côté client.
     *
     * Next conserve en mémoire le contenu déjà rendu des pages visitées, et le
     * ressert lors d'une navigation client — bouton retour, clic sur un lien
     * déjà parcouru. D'où l'impression de « revenir à une version antérieure
     * du projet », qu'un rechargement manuel corrigeait.
     *
     * Sur un site dont les scores et les prix sont recalculés à chaque crawl,
     * resservir un rendu vieux de quelques minutes n'a aucun intérêt : chaque
     * page est déjà servie en quelques millisecondes grâce aux index
     * dénormalisés. On préfère donc toujours redemander au serveur.
     *
     * `static` ne descend toutefois plus sous 30 depuis Next 16. La valeur 0
     * était refusée au démarrage, et Next retombait alors sur SON défaut, bien
     * plus long que 30 : demander zéro donnait l'inverse de zéro. 30 est le
     * minimum accepté, et il reste sans effet visible ici, les pages concernées
     * se revalidant déjà toutes les 60 secondes.
     */
    staleTimes: {
      dynamic: 0,
      static: 30,
    },
  },
};

export default config;
