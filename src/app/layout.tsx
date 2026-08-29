import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import './globals.css';
import { SearchBar } from '@/components/SearchBar';

export const metadata: Metadata = {
  title: 'Item Finder — les vrais rabais, vérifiés',
  description:
    'Comparateur de rabais qui vérifie chaque prix contre son propre historique, au lieu de croire le prix barré du marchand.',
};

const NAV = [
  { href: '/', label: 'Découvrir' },
  { href: '/categories', label: 'Catégories' },
  { href: '/magasins', label: 'Magasins' },
  { href: '/recherche', label: 'Recherche' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr-CA">
      <body className="min-h-screen">
        <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-8 gap-y-3 px-5 py-3.5">
            <Link href="/" className="group flex shrink-0 items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-[15px] font-black text-ink">
                IF
              </span>
              <span className="text-[15px] font-semibold tracking-tight">Item Finder</span>
            </Link>

            <nav className="flex shrink-0 items-center gap-1 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="rounded-lg px-3 py-1.5 text-muted transition-colors hover:bg-raised hover:text-text"
                >
                  {n.label}
                </Link>
              ))}
            </nav>

            <div className="ml-auto w-full min-w-[220px] sm:w-auto sm:flex-1 sm:max-w-md">
              {/*
                SearchBar lit les paramètres d'URL (useSearchParams) pour rester
                synchronisée avec la recherche en cours. Next exige une limite
                Suspense autour de tout composant qui les lit, sinon le
                pré-rendu statique échoue — ce qui cassait le build de
                production sur la page 404 alors que le mode dev l'acceptait.
                Le repli est un bloc de la même hauteur, pour éviter tout saut
                de mise en page pendant l'hydratation.
              */}
              <Suspense
                fallback={<div className="h-9 rounded-xl border border-line bg-surface" />}
              >
                <SearchBar compact />
              </Suspense>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-5 py-8">{children}</main>

        <footer className="mt-20 border-t border-line">
          <div className="mx-auto max-w-[1400px] px-5 py-8 text-sm text-faint">
            <p className="max-w-3xl leading-relaxed">
              Les scores sont calculés à partir de notre propre historique de prix, jamais du
              seul prix barré affiché par le marchand. Un score s&apos;accompagne toujours d&apos;un
              indice de confiance : plus l&apos;historique est long, plus il est fiable.
            </p>
            <p className="mt-3">
              Les prix peuvent avoir changé depuis le dernier passage. Vérifiez toujours chez le
              marchand avant d&apos;acheter.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
