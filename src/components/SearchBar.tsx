'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Barre de recherche : historique local et suggestions à la frappe.
 *
 * Deux contenus se relaient dans le même menu, selon ce que l'utilisateur a
 * tapé — champ vide, on propose ses recherches passées ; dès deux caractères,
 * on propose des complétions. C'est le comportement d'un moteur de recherche,
 * et il évite d'avoir deux panneaux concurrents.
 *
 * L'historique vit dans localStorage : ce sont les recherches de CE navigateur,
 * elles n'ont rien à faire sur le serveur. Chaque accès est protégé par
 * try/catch — en navigation privée, un simple `getItem` peut lever, et ça ne
 * doit jamais casser la barre de recherche.
 *
 * Les suggestions, elles, viennent du serveur : le catalogue fait 200 000
 * produits et n'a rien à faire dans le navigateur.
 */

const STORAGE_KEY = 'itemfinder:recherches';
const VISIBLE = 5;
const KEPT = 25;

/**
 * Délai avant d'interroger le serveur. Assez court pour paraître instantané,
 * assez long pour ne pas lancer une requête par touche pendant la frappe.
 */
const DEBOUNCE_MS = 130;

interface Suggestion {
  value: string;
  kind: 'marque' | 'categorie' | 'produit';
  hint?: string;
  /** Destination directe, quand la suggestion désigne une chose précise. */
  href?: string;
}

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeHistory(list: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, KEPT)));
  } catch {
    // Stockage indisponible : l'historique est un confort, pas une fonction
    // critique. On continue sans.
  }
}

const KIND_LABEL: Record<Suggestion['kind'], string> = {
  marque: 'Marque',
  categorie: 'Catégorie',
  produit: '',
};

export function SearchBar({
  compact = false,
  autoFocus = false,
}: {
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const rootRef = useRef<HTMLDivElement>(null);

  // On lit localStorage APRÈS le montage : le rendu serveur ne le connaît pas,
  // et l'initialiser directement provoquerait une erreur d'hydratation.
  useEffect(() => {
    setHistory(readHistory());
  }, []);

  useEffect(() => {
    setValue(params.get('q') ?? '');
  }, [params]);

  // Interrogation différée du serveur, annulée si la saisie change entre-temps.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/suggestions?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      } catch {
        // Requête annulée ou réseau indisponible : on garde l'affichage actuel
        // plutôt que de vider la liste sous les doigts de l'utilisateur.
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const remember = useCallback((q: string) => {
    setHistory((prev) => {
      // Une recherche répétée remonte en tête au lieu d'être dupliquée.
      const next = [q, ...prev.filter((x) => x.toLowerCase() !== q.toLowerCase())];
      writeHistory(next);
      return next.slice(0, KEPT);
    });
  }, []);

  const go = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      setOpen(false);
      setHighlight(-1);
      if (trimmed) remember(trimmed);
      router.push(trimmed ? `/recherche?q=${encodeURIComponent(trimmed)}` : '/recherche');
    },
    [remember, router],
  );

  /**
   * Choisit une suggestion. Celles qui désignent une chose précise (un produit,
   * un rayon) mènent DIRECTEMENT à sa page ; seules les suggestions textuelles
   * relancent une recherche.
   *
   * Auparavant tout passait par la recherche, y compris les titres de produits
   * tronqués — dont les points de suspension ne trouvaient évidemment rien.
   */
  const choose = useCallback(
    (s: Suggestion) => {
      setOpen(false);
      setHighlight(-1);
      if (s.href) {
        router.push(s.href);
        return;
      }
      setValue(s.value);
      go(s.value);
    },
    [go, router],
  );

  function removeOne(q: string) {
    setHistory((prev) => {
      const next = prev.filter((x) => x !== q);
      writeHistory(next);
      return next;
    });
  }

  function clearAll() {
    setHistory([]);
    writeHistory([]);
    setOpen(false);
  }

  const typing = value.trim().length >= 2;
  const visibleHistory = history.slice(0, VISIBLE);
  const items = typing ? suggestions.map((s) => s.value) : visibleHistory;
  const showMenu = open && items.length > 0;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      setHighlight(-1);
      return;
    }
    if (!showMenu) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? items.length - 1 : h - 1));
    } else if (e.key === 'Enter' && highlight >= 0) {
      e.preventDefault();
      if (typing) choose(suggestions[highlight]);
      else {
        const q = visibleHistory[highlight];
        setValue(q);
        go(q);
      }
    }
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
          aria-hidden
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => {
            setValue(e.target.value);
            setHighlight(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Chercher un produit, une marque, un modèle…"
          aria-label="Rechercher"
          aria-expanded={showMenu}
          aria-autocomplete="list"
          role="combobox"
          autoComplete="off"
          className={`w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-text placeholder:text-faint outline-none transition-colors focus:border-brand/60 ${
            compact ? 'h-9 text-[13px]' : 'h-12 text-[15px]'
          }`}
        />
      </form>

      {showMenu && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl shadow-black/50"
        >
          <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wide text-faint">
            {typing ? 'Suggestions' : 'Recherches récentes'}
          </p>

          <ul>
            {typing
              ? suggestions.map((s, i) => (
                  <li key={`${s.kind}:${s.value}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === highlight}
                      onClick={() => choose(s)}
                      // Le survol est traité en CSS (`hover:`), pas en état
                      // React : mettre à jour un état à chaque mouvement de
                      // souris relançait le rendu de toute la liste, d'où la
                      // sensation de décalage. L'état ne sert plus qu'au
                      // clavier.
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-raised hover:text-text ${
                        i === highlight ? 'bg-raised text-text' : 'text-muted'
                      }`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        className="h-3.5 w-3.5 shrink-0 text-faint"
                        aria-hidden
                      >
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                      </svg>
                      <span className="min-w-0 flex-1 truncate">{s.value}</span>
                      {(KIND_LABEL[s.kind] || s.hint) && (
                        <span className="shrink-0 text-[10px] text-faint">
                          {KIND_LABEL[s.kind] || s.hint}
                        </span>
                      )}
                    </button>
                  </li>
                ))
              : visibleHistory.map((q, i) => (
                  <li key={q} className="group/item flex items-center">
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === highlight}
                      onClick={() => {
                        setValue(q);
                        go(q);
                      }}
                      className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-raised hover:text-text ${
                        i === highlight ? 'bg-raised text-text' : 'text-muted'
                      }`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        className="h-3.5 w-3.5 shrink-0 text-faint"
                        aria-hidden
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" strokeLinecap="round" />
                      </svg>
                      <span className="truncate">{q}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => removeOne(q)}
                      aria-label={`Supprimer « ${q} » de l'historique`}
                      title="Supprimer"
                      className="mr-1.5 shrink-0 rounded-md p-1.5 text-faint opacity-0 transition-all hover:bg-raised hover:text-hot focus:opacity-100 group-hover/item:opacity-100"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        className="h-3.5 w-3.5"
                        aria-hidden
                      >
                        <path d="M4 7h16M10 11v6M14 11v6" strokeLinecap="round" />
                        <path d="M6 7l1 13h10l1-13M9 7V4h6v3" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </li>
                ))}
          </ul>

          {!typing && (
            <button
              type="button"
              onClick={clearAll}
              className="w-full border-t border-line-soft px-3 py-1.5 text-left text-[11px] text-faint transition-colors hover:bg-raised hover:text-hot"
            >
              Supprimer tout l&apos;historique
            </button>
          )}
        </div>
      )}
    </div>
  );
}
