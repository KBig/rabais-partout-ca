import type { NextConfig } from 'next';

const config: NextConfig = {
  // better-sqlite3 est un module natif : il doit rester externe au bundle
  // serveur, sinon Next tente de le compiler et échoue.
  serverExternalPackages: ['better-sqlite3'],

  experimental: {
    // Restaure la position de défilement lors d'un retour arrière.
    //
    // Sans cela, revenir d'une fiche produit vers un listing ramenait tout en
    // haut de la page — insupportable après avoir fait défiler cinquante
    // produits pour en ouvrir un.
    scrollRestoration: true,
  },
};

export default config;
