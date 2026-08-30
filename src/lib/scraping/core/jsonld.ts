/**
 * LES DONNEES STRUCTUREES D'UNE FICHE PRODUIT.
 *
 * La plupart des marchands publient, dans un bloc `application/ld+json`, le
 * nom, le prix, l'image et la note de l'article — pour que Google les affiche.
 * C'est la meme information que la page montre, sous une forme faite pour etre
 * lue par une machine.
 *
 * Trois adaptateurs en dependent aujourd'hui — Costco, Walmart, et les
 * boutiques qui n'exposent rien d'autre. Le code vivait dupilque chez Costco ;
 * il est ici pour que le suivant n'ait pas a le reecrire.
 */

export interface JsonLdProduct {
  '@type'?: string | string[];
  name?: string;
  image?: string | string[] | { url?: string };
  description?: string;
  sku?: string;
  mpn?: string;
  url?: string;
  brand?: { name?: string } | string;
  aggregateRating?: { ratingValue?: number | string; ratingCount?: number | string };
  offers?:
    | {
        price?: number | string;
        priceCurrency?: string;
        availability?: string;
        seller?: { name?: string } | string;
      }
    | Array<{
        price?: number | string;
        priceCurrency?: string;
        availability?: string;
        seller?: { name?: string } | string;
      }>;
}

export interface JsonLdBreadcrumb {
  '@type'?: string | string[];
  itemListElement?: Array<{ name?: string; position?: number; item?: { name?: string } }>;
}

const estDuType = (b: unknown, type: string): boolean => {
  const t = (b as { '@type'?: string | string[] })?.['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
};

/**
 * Tous les blocs JSON-LD d'une page, a plat.
 *
 * Un bloc malforme ne doit pas empecher de lire les suivants : certains
 * marchands en publient trois, dont un casse par un guillemet mal echappe.
 * Les enveloppes `@graph` sont ouvertes, sinon le produit qu'elles contiennent
 * resterait invisible.
 */
export function blocsJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      const liste = Array.isArray(j) ? j : [j];
      for (const b of liste) {
        const graphe = (b as { '@graph'?: unknown[] })?.['@graph'];
        if (Array.isArray(graphe)) out.push(...graphe);
        else out.push(b);
      }
    } catch {
      // Bloc illisible : on passe au suivant.
    }
  }
  return out;
}

/** Le bloc « Product » de la page, s'il y en a un. */
export const produitJsonLd = (blocs: unknown[]): JsonLdProduct | undefined =>
  blocs.find((b) => estDuType(b, 'Product')) as JsonLdProduct | undefined;

/**
 * Le fil d'Ariane, du rayon general a la feuille.
 *
 * Certains marchands mettent le libelle dans `name`, d'autres dans `item.name`.
 * Les deux sont acceptes : imposer une seule forme ferait perdre le rayon —
 * donc la categorie — chez la moitie d'entre eux.
 */
export function filJsonLd(blocs: unknown[]): string[] {
  const fil = blocs.find((b) => estDuType(b, 'BreadcrumbList')) as JsonLdBreadcrumb | undefined;
  return (fil?.itemListElement ?? [])
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((e) => e.name ?? e.item?.name)
    .filter((n): n is string => Boolean(n && n.trim()));
}

/** La premiere offre, que le marchand en publie une ou plusieurs. */
export function offreJsonLd(p: JsonLdProduct) {
  return Array.isArray(p.offers) ? p.offers[0] : p.offers;
}

/**
 * Un nombre, quelle que soit la forme sous laquelle il arrive.
 *
 * Les prix arrivent en nombre, en chaine, avec un symbole, avec une virgule
 * decimale. Une chaine vide ou « null » textuel doit rendre `null`, pas zero :
 * un prix de zero passerait pour une aubaine extraordinaire.
 */
export function nombreJsonLd(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = Number(v.replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}
