import Link from 'next/link';

/**
 * Page 404.
 *
 * Sans ce fichier, Next sert une page nue, hors du thème du site — et c'est
 * justement elle qui faisait échouer le build de production, parce qu'elle est
 * pré-rendue statiquement alors que la barre de recherche du gabarit lit les
 * paramètres d'URL. Une 404 soignée, c'est aussi une manière de ne pas laisser
 * l'utilisateur dans une impasse : on lui propose des sorties.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-24 text-center">
      <p className="tnum text-5xl font-bold text-brand">404</p>
      <h1 className="mt-4 text-xl font-semibold">Cette page n&apos;existe pas.</h1>
      <p className="mt-2 text-sm text-muted">
        Le produit a peut-être été retiré du catalogue, ou l&apos;adresse est
        incorrecte.
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <Link
          href="/"
          className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
        >
          Découvrir les deals
        </Link>
        <Link
          href="/categories"
          className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-text"
        >
          Parcourir les catégories
        </Link>
        <Link
          href="/recherche"
          className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-text"
        >
          Rechercher
        </Link>
      </div>
    </div>
  );
}
