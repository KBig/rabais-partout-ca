'use client';

import { useState, useMemo, useCallback } from 'react';

/**
 * Image produit : bonne résolution, et repli si elle manque.
 *
 * Trois problèmes réels, réglés ensemble.
 *
 * 1. LA TAILLE. Une première version prenait toujours la plus haute
 *    résolution disponible — du 1500×1500 pour des vignettes de 200 px.
 *    Quarante cartes dépassaient 10 Mo, la page ramait, et les images
 *    restaient vides assez longtemps pour paraître cassées. On choisit
 *    maintenant la résolution la plus proche de la taille d'affichage réelle.
 *
 * 2. LES TROUS. Les CDN marchands n'hébergent pas toutes les résolutions pour
 *    tous les articles : chez Best Buy, le 1000×1000 renvoie 404 sur des
 *    produits dont le 1500×1500 existe. À chaque échec on descend d'un cran ;
 *    si tout échoue, on affiche l'initiale de la marque plutôt que l'icône
 *    d'image brisée du navigateur.
 *
 * Les variantes sont DÉRIVÉES de l'URL, pas stockées. Les garder en base
 * coûtait 48 Mo de pure redondance pour une information entièrement
 * reconstructible — et cette taille bloquait l'hébergement gratuit.
 */

/**
 * Paliers de résolution réellement servis par les CDN marchands.
 *
 * Le 1000×1000 a été RETIRÉ après vérification : chez Best Buy il renvoie 404
 * sur de nombreux produits dont le 1500×1500 existe. La fiche produit, qui
 * visait 1000 px, tentait donc systématiquement une résolution inexistante ;
 * la chaîne de repli faisait son travail, mais après un aller-retour perdu —
 * assez long pour que l'image paraisse manquante.
 *
 * Mieux vaut un barreau court et fiable qu'un barreau complet et optimiste.
 */
const SIZE_LADDER = [150, 250, 500, 1500];

/** Segment de taille dans un chemin CDN : .../products/1500x1500/191/... */
const SIZE_SEGMENT = /\/(\d{2,4})x\d{2,4}\//;

/**
 * Dérive les variantes de résolution d'une URL, classées par écart à la taille
 * voulue. Une URL sans segment de taille reconnaissable est renvoyée telle
 * quelle : la fonction reste inoffensive pour les magasins qui n'utilisent pas
 * ce format.
 */
function candidatesFor(src: string, targetWidth: number): string[] {
  const match = src.match(SIZE_SEGMENT);
  if (!match) return [src];

  const original = Number(match[1]);
  const sizes = [...new Set([...SIZE_LADDER, original])].sort((a, b) => {
    // À écart égal, on préfère la version légèrement PLUS grande : plus nette
    // sur écran haute densité.
    const da = Math.abs(a - targetWidth) - (a >= targetWidth ? 0.5 : 0);
    const db = Math.abs(b - targetWidth) - (b >= targetWidth ? 0.5 : 0);
    return da - db;
  });

  return sizes.map((s) => src.replace(SIZE_SEGMENT, `/${s}x${s}/`));
}

export function ProductImage({
  src,
  alt,
  brand,
  targetWidth = 500,
  priority = false,
  className = '',
  fallbackClassName = '',
}: {
  src: string | null;
  alt: string;
  brand?: string | null;
  /** Largeur d'affichage visée, en pixels CSS. Détermine la résolution choisie. */
  targetWidth?: number;
  /**
   * Vignette visible dès l'ouverture de la page. Elle est chargée
   * immédiatement et en priorité, au lieu d'attendre le défilement.
   *
   * Tout mettre en `lazy` paraissait économe, mais produisait l'effet inverse :
   * même les cartes situées en haut de l'écran restaient vides un instant,
   * ce qui donne l'impression que les images ne chargent pas.
   */
  priority?: boolean;
  className?: string;
  fallbackClassName?: string;
}) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  /**
   * Rattrape les images DEJA EN CACHE.
   *
   * C'etait le defaut le plus penible et le plus sournois : en revenant sur une
   * page deja visitee, les images disparaissaient.
   *
   * La cause : l'image est masquee (`opacity-0`) jusqu'au declenchement de
   * `onLoad`. Or une image en cache est COMPLETE avant meme que React n'attache
   * l'ecouteur — l'evenement appartient deja au passe, ne se declenche jamais,
   * et l'image reste invisible indefiniment.
   *
   * On interroge donc l'element directement des qu'il existe, au lieu
   * d'attendre un evenement qui n'aura pas lieu.
   */
  const attacher = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) setLoaded(true);
  }, []);

  const sources = useMemo(
    () => (src ? candidatesFor(src, targetWidth) : []),
    [src, targetWidth],
  );

  const current = sources[index] ?? null;

  if (!current) {
    const initials = (brand ?? alt).trim().slice(0, 2).toUpperCase();
    return (
      <div
        className={`grid h-full w-full place-items-center bg-raised ${fallbackClassName}`}
        aria-label={alt}
        role="img"
      >
        <div className="flex flex-col items-center gap-1.5 px-3 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-line text-sm font-bold text-faint">
            {initials || '?'}
          </span>
          <span className="text-[10px] text-faint">image indisponible</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Fond neutre pendant le chargement : évite le clignotement blanc. */}
      {!loaded && <div className="absolute inset-0 animate-pulse bg-raised" aria-hidden />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        // La clé force React à remonter un <img> neuf à chaque candidate :
        // sans elle, le navigateur peut conserver l'état d'erreur précédent.
        key={current}
        ref={attacher}
        src={current}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        onError={() => {
          setLoaded(false);
          setIndex((i) => i + 1);
        }}
        onLoad={() => setLoaded(true)}
        className={`${className} ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`}
      />
    </>
  );
}
