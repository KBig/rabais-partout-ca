'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Retour à la page précédente, à l'endroit exact où on l'avait quittée.
 *
 * On appelle `router.back()` plutôt que de pointer vers une URL : c'est une
 * navigation dans l'historique du navigateur, donc la position de défilement
 * est restaurée par le navigateur lui-même. Un lien vers `/categories/x`
 * rechargerait la page et ramènerait tout en haut — précisément ce qu'on veut
 * éviter quand on a fait défiler cinquante produits avant d'en ouvrir un.
 *
 * Le bouton ne s'affiche que s'il y a réellement où revenir : arrivé
 * directement par un lien partagé, il n'aurait aucun sens.
 */
export function BackButton({ label = 'Retour' }: { label?: string }) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    // history.length > 1 signale une navigation antérieure dans cet onglet.
    // Vérifié après le montage : `history` n'existe pas au rendu serveur.
    try {
      setCanGoBack(window.history.length > 1);
    } catch {
      setCanGoBack(false);
    }
  }, []);

  if (!canGoBack) return null;

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-faint transition-colors hover:bg-raised hover:text-text"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label}
    </button>
  );
}
