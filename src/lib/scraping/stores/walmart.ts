import type { StoreAdapter, RawProduct, CrawlContext } from '../types';
import { enParallele } from '../core/parallele';
import { pageDeReprise, avancerCurseur } from '../core/curseur';
import { urlsMortes, noterUrlMorte, noterUrlVivante } from '../core/urls-mortes';
import { HttpError } from '../core/http';
import {
  blocsJsonLd,
  produitJsonLd,
  filJsonLd,
  offreJsonLd,
  nombreJsonLd,
  type JsonLdProduct,
} from '../core/jsonld';

/**
 * Walmart Canada.
 *
 * ----------------------------------------------------------------------------
 * CE QUI ETAIT FAUX DANS MON PREMIER DIAGNOSTIC
 * ----------------------------------------------------------------------------
 *
 * J'avais declare Walmart inaccessible. C'etait vrai — mais d'une seule page.
 * Leurs listes et leur recherche sont protegees par un defi anti-robot, et
 * franchir un tel defi n'est pas une chose que je ferai.
 *
 * J'en avais conclu que tout le site l'etait. Faux, et verifiable en deux
 * requetes : leur `robots.txt` n'interdit que le panier, la recherche et
 * quelques chemins internes — les fiches produit sont explicitement permises.
 * Et ces fiches repondent normalement, sans defi, avec un bloc de donnees
 * structurees qui porte le nom, le prix, la note et la disponibilite.
 *
 * Ils publient par-dessus le marche seize sitemaps. Celui des articles vendus
 * par Walmart lui-meme en annonce 218 257.
 *
 * La lecon vaut d'etre ecrite : « ce marchand bloque » etait une conclusion
 * tiree d'un seul essai sur une seule page.
 *
 * ----------------------------------------------------------------------------
 * PREMIERE PARTIE SEULEMENT
 * ----------------------------------------------------------------------------
 *
 * Leurs sitemaps distinguent le « 1P » — ce que Walmart vend et expedie — du
 * « 3P », la place de marche, qui compte 860 000 articles de plus. On s'en
 * tient au 1P : sur une place de marche, le meme objet existe en trente
 * exemplaires a trente prix, et cette repetition noierait le classement sans
 * rien apprendre a personne. Le champ `marketplace` existe pour le jour ou l'on
 * changera d'avis.
 */

const BASE = 'https://www.walmart.ca';
const WALMART_ID = 'walmart-ca';

/**
 * Index de sitemaps a suivre. Le francais d'abord : c'est la langue du site.
 *
 * Chacun renvoie vers des fichiers « .xml.gz » — compresses DANS le fichier, ce
 * que `fetch` ne defait pas tout seul.
 */
const INDEX = [`${BASE}/sitemap-product-1p-fr.xml`];

/**
 * Fiches lues en meme temps.
 *
 * Une par produit : c'est le cout de ce marchand, et il n'y a pas de liste a
 * lire d'un coup comme chez Shopify. Leur `robots.txt` n'impose aucun delai ;
 * on reste malgre tout modeste, la politesse ne se mesurant pas seulement a ce
 * qui est autorise.
 */
const EN_PARALLELE = 6;

/** Fiches lues par passage. Le curseur reprend a la suivante au passage d'apres. */
const TRANCHE = 4000;

/**
 * Fil d'Ariane vers notre categorie.
 *
 * Meme discipline qu'ailleurs : des motifs etroits, et un rayon non reconnu est
 * ignore plutot que range au hasard. Un produit mal classe fausse la mediane de
 * toute une categorie, et donc les rabais qu'on en deduit.
 */
const REGLES: ReadonlyArray<readonly [RegExp, string]> = [
  [/t[ée]l[ée]viseur|television\b|\btv\b/i, 'televiseurs'],
  [/portable|laptop|ordinateur portatif/i, 'portables'],
  [/ordinateur de bureau|desktop/i, 'ordinateurs'],
  [/tablette|ipad/i, 'tablettes'],
  [/t[ée]l[ée]phone|cellulaire|smartphone/i, 'telephones'],
  [/[ée]couteur|casque d.[ée]coute|headphone/i, 'casques'],
  [/moniteur|[ée]cran d.ordinateur/i, 'moniteurs'],
  [/console|jeux? vid[ée]o|playstation|xbox|nintendo/i, 'jeux-video'],
  [/montre intelligente|smartwatch/i, 'montres'],
  [/appareil photo|cam[ée]ra/i, 'cameras'],
  [/audio|haut-parleur|barre de son|chaine st[ée]r[ée]o/i, 'audio'],

  [/r[ée]frig[ée]rateur|cuisini[èe]re|lave-vaisselle|laveuse|s[ée]cheuse|cong[ée]lateur/i, 'gros-electro'],
  [/micro-?ondes|grille-pain|caf[ée]ti[èe]re|friteuse|m[ée]langeur|robot culinaire/i, 'petits-electro'],
  [/aspirateur|balai [ée]lectrique/i, 'aspirateurs'],

  [/matelas|sommier/i, 'matelas'],
  [/literie|draps?|couette|oreiller/i, 'literie'],
  [/meubles? de salon|canap[ée]|sofa|fauteuil/i, 'salon'],
  [/salle [àa] manger|table de cuisine/i, 'salle-a-manger'],
  [/chambre [àa] coucher|commode|t[êe]te de lit/i, 'chambre'],
  [/luminaire|lampe|[ée]clairage/i, 'luminaires'],
  [/rangement|[ée]tag[èe]re|organisation/i, 'rangement'],
  [/d[ée]cor|coussin|cadre|miroir/i, 'decoration'],
  [/cuisine|vaisselle|ustensile|casserole|batterie de cuisine/i, 'cuisine'],
  [/meubles? de bureau|chaise de bureau/i, 'bureau-meubles'],

  [/jardin|terrasse|barbecue|pelouse/i, 'jardinage'],
  [/sport|v[ée]lo|exercice|entra[îi]nement|plein air/i, 'sport'],
  [/jouet|jeu de soci[ée]t[ée]/i, 'jouets'],
  [/b[ée]b[ée]|poussette|couche/i, 'bebe'],
  [/animalerie|chien|chat\b/i, 'animaux'],
  [/bagage|valise/i, 'bagages'],
  [/v[êe]tement|chandail|pantalon|manteau/i, 'vetements'],
];

/** Rayons a ne jamais collecter : ce ne sont pas des produits comparables. */
const IGNORER =
  /carte-?cadeau|gift ?card|abonnement|garantie prolong[ée]e|installation|service|pharmacie|[ée]picerie|alcool|bi[èe]re|vin\b/i;

function slugDepuisFil(chemin: string[]): string | null {
  if (chemin.some((n) => IGNORER.test(n))) return null;
  // De la feuille vers la racine : le rayon le plus precis decrit le mieux.
  for (const niveau of [...chemin].reverse()) {
    for (const [motif, slug] of REGLES) if (motif.test(niveau)) return slug;
  }
  return null;
}

/**
 * Le bloc utile arrive tot dans le document.
 *
 * Une fiche Walmart pese plus de trois cents kilo-octets, dont l'essentiel est
 * du code d'interface. On arrete la lecture des que le bloc produit est
 * complet : c'est autant de donnees qu'ils n'ont pas a servir.
 */
const assezLu = (contenu: string): boolean => {
  const i = contenu.indexOf('"@type":"Product"');
  return i >= 0 && contenu.indexOf('</script>', i) >= 0;
};

export function extraireFiche(html: string, url: string): RawProduct | null {
  const blocs = blocsJsonLd(html);
  const prod = produitJsonLd(blocs);
  if (!prod?.name) return null;

  const offre = offreJsonLd(prod);
  const prix = nombreJsonLd(offre?.price);
  if (!prix) return null;

  const chemin = filJsonLd(blocs);
  const slug = slugDepuisFil([...chemin, prod.name]);
  if (!slug) return null;

  const image = imageDe(prod);
  const marque = typeof prod.brand === 'string' ? prod.brand : prod.brand?.name;
  const avis = Number(prod.aggregateRating?.ratingCount ?? 0);

  // La reference est en fin d'adresse : « /fr/ip/<nom>/<ID> ».
  const sku = url.match(/\/ip\/[^/]*\/([A-Z0-9]{6,})/i)?.[1] ?? prod.sku ?? url;

  return {
    sku,
    url,
    title: prod.name.trim(),
    brand: marque?.trim() || null,
    model: prod.mpn?.trim() || prod.sku?.trim() || null,
    imageUrl: image,
    imageUrls: image ? [image] : [],
    description: prod.description?.trim() || null,
    price: prix,
    // Leur bloc structure ne porte pas de prix barre. Ne rien annoncer vaut
    // mieux qu'annoncer un rabais qu'on n'a pas mesure.
    listPrice: null,
    currency: offre?.priceCurrency ?? 'CAD',
    inStock: offre?.availability ? !/OutOfStock|SoldOut|Discontinued/i.test(offre.availability) : null,
    rating: avis > 0 ? nombreJsonLd(prod.aggregateRating?.ratingValue) : null,
    ratingCount: avis > 0 ? avis : null,
    storeCategory: chemin[chemin.length - 1] ?? null,
    categorySlug: slug,
    condition: 'new',
    availability: 'les-deux',
    // Ce sitemap ne contient que le « 1P » : vendu et expedie par Walmart.
    marketplace: false,
    sellerName: null,
  };
}

function imageDe(p: JsonLdProduct): string | null {
  const i = p.image;
  if (!i) return null;
  if (typeof i === 'string') return i;
  if (Array.isArray(i)) return typeof i[0] === 'string' ? i[0] : null;
  return i.url ?? null;
}

/** Les fiches produit annoncees par leurs sitemaps. */
async function urlsProduit(ctx: CrawlContext): Promise<string[]> {
  const urls: string[] = [];

  for (const index of INDEX) {
    if (ctx.signal.aborted) break;
    let sous: string[] = [];
    try {
      const xml = await ctx.getMaybeGzip(index);
      sous = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    } catch {
      continue; // un index indisponible ne doit pas interrompre les autres
    }

    for (const s of sous) {
      if (ctx.signal.aborted) break;
      try {
        const xml = await ctx.getMaybeGzip(s);
        for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
          if (/\/ip\//.test(m[1])) urls.push(m[1]);
        }
      } catch {
        // Un sous-sitemap absent ne condamne pas les autres.
      }
    }
  }
  return urls;
}

async function* parcourir(ctx: CrawlContext, filtre?: string): AsyncGenerator<RawProduct> {
  const annoncees = await urlsProduit(ctx);
  if (annoncees.length === 0) {
    ctx.log('  aucun sitemap lisible — collecte annulee');
    return;
  }

  // Les adresses qu'on sait mortes sont ecartees AVANT le decoupage : sinon une
  // tranche entiere pourrait n'etre faite que de 404.
  const mortes = urlsMortes(WALMART_ID);
  const urls = mortes.size > 0 ? annoncees.filter((u) => !mortes.has(u)) : annoncees;
  ctx.log(
    `  ${annoncees.length} fiches annoncees` +
      (mortes.size > 0 ? `, ${mortes.size} connues mortes -> ${urls.length} a lire` : ''),
  );

  /**
   * ON REPREND OU LE PASSAGE PRECEDENT S'EST ARRETE.
   *
   * Deux cent mille fiches, une requete chacune : aucun passage ne les lit
   * toutes. Repartir du debut reviendrait a relire eternellement les memes
   * premieres, et a ne jamais atteindre le reste.
   */
  const numero = pageDeReprise(WALMART_ID).page;
  const debut = (numero - 1) * TRANCHE;
  const aLire = urls.slice(debut, debut + TRANCHE);
  const derniere = debut + TRANCHE >= urls.length;

  if (aLire.length === 0) {
    avancerCurseur(WALMART_ID, '', 1, true);
    return;
  }
  ctx.log(`  tranche ${numero} : fiches ${debut + 1} a ${debut + aLire.length}`);

  let emis = 0;
  let ignores = 0;

  const fiches = enParallele(
    aLire,
    EN_PARALLELE,
    async (url) => {
      try {
        const fiche = extraireFiche(await ctx.getPartial(url, assezLu), url);
        if (fiche) noterUrlVivante(WALMART_ID, url);
        else noterUrlMorte(WALMART_ID, url);
        return fiche;
      } catch (e) {
        // SEULS les echecs definitifs sont retenus. Un 429 ou un 500 vient de
        // leur cote et passera ; l'oublier effacerait une fiche valide.
        if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 429) {
          noterUrlMorte(WALMART_ID, url, true);
        }
        return null;
      }
    },
    () => ctx.signal.aborted || emis >= ctx.limits.maxProducts,
  );

  for await (const brut of fiches) {
    if (ctx.signal.aborted || emis >= ctx.limits.maxProducts) break;
    if (!brut) {
      ignores++;
      continue;
    }
    if (filtre && brut.categorySlug !== filtre) continue;

    yield brut;
    emis++;
    if (emis % 250 === 0) ctx.log(`  … ${emis} produits retenus (${ignores} ecartes)`);
  }

  // Une interruption laisse la tranche a moitie lue : avancer sauterait des
  // fiches jamais vues. On ne bouge que sur une tranche entierement parcourue.
  if (!ctx.signal.aborted) {
    avancerCurseur(WALMART_ID, '', numero + 1, derniere);
    if (derniere) ctx.log('  fin du sitemap — le prochain passage repart du debut');
  }
}

export const walmartAdapter: StoreAdapter = {
  id: WALMART_ID,
  // Une requete par fiche : la recherche est de toute facon interdite par leur
  // robots.txt, et protegee par un defi qu'on ne cherche pas a franchir.
  capabilities: { deals: true, categories: true, search: false },
  categories: [...new Set(REGLES.map(([, s]) => s))],
  listDeals: (ctx) => parcourir(ctx),
  listCategory: (slug, ctx) => parcourir(ctx, slug),
};
