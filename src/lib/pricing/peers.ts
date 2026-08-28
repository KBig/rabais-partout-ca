import { db } from '../db';

/**
 * Comparaison par PAIRS — la réponse au démarrage à froid.
 *
 * Le moteur d'historique répond à « ce produit est-il moins cher qu'AVANT ? ».
 * Utile, mais inutilisable le premier jour, et impossible à reconstituer : si
 * personne n'a noté le prix d'un aspirateur en mars 2024, la donnée n'existe
 * nulle part.
 *
 * Ce module répond à une question différente et complémentaire :
 * « ce produit est-il moins cher que ses ÉQUIVALENTS, maintenant ? »
 *
 * Quand la comparaison dans le TEMPS manque, on la remplace par la comparaison
 * dans l'ESPACE. Un 65 po OLED à 1 299 $ pendant que tous ses équivalents sont
 * entre 1 800 $ et 2 400 $ est manifestement une bonne affaire, et aucun
 * historique n'est nécessaire pour l'établir.
 *
 * Ce signal est disponible DÈS LE PREMIER CRAWL, ce qui donne au système une
 * réponse solide à toutes les étapes de sa vie.
 */

/**
 * Comparer un téléviseur 43 po à un 85 po n'a aucun sens : ils ne sont pas
 * substituables. On extrait donc du titre une « classe de taille/capacité »
 * qui rend les produits réellement comparables entre eux.
 *
 * Les motifs sont volontairement simples et lisibles. Un produit dont on ne
 * sait rien extraire tombe dans la classe générique de sa catégorie, ce qui
 * reste utilisable même si c'est moins précis.
 */
const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Type de produit, extrait de la TETE du titre.
 *
 * Les titres marchands commencent presque toujours par le type de l'objet :
 * « Haut-parleur de plafond encastrable... », « Friteuse a air chaud... »,
 * « Televiseur intelligent Tizen... ». Ce premier mot discrimine bien mieux
 * que la categorie seule.
 *
 * Sans lui, le rayon « audio » melangeait un haut-parleur encastrable a 60 $
 * avec des systemes home cinema a 3 000 $, et le haut-parleur ressortait
 * « 86 % sous la mediane » — une comparaison entre objets non substituables.
 *
 * Si le premier mot est la marque, on prend le suivant : « Apple MacBook Air »
 * doit donner « macbook », pas « apple ».
 */
export function typeToken(title: string, brand: string | null): string {
  const t = normalize(title)
    // Le prefixe d'etat peut porter une precision entre parentheses
    // (« Remis a neuf (Tres bon etat) - ... ») et les parentheses peuvent
    // meme entourer le prefixe entier (« (Boite ouverte) - ... »). Une
    // version anterieure ne gerait que la forme simple : le type extrait
    // devenait alors le mot « remis », et 113 articles allant de 3,99 $ a
    // 9 999,98 $ se retrouvaient dans le meme groupe de pairs.
    .replace(
      /^\(?\s*(?:boite ouverte|open box|open-box|remis a neuf|remise a neuf|refurbished|reconditionne)\s*\)?\s*(?:\([^)]*\))?\s*[-\u2013\u2014,]*\s*/,
      '',
    )
    .trim();

  const words = t
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9-]/g, ''))
    .filter((w) => w.length >= 3);

  if (words.length === 0) return 'inconnu';

  const brandNorm = brand ? normalize(brand) : null;
  const head = brandNorm && words[0] === brandNorm && words[1] ? words[1] : words[0];

  return head.slice(0, 14);
}

export function peerKey(
  categorySlug: string | null,
  title: string,
  condition: string,
  brand: string | null = null,
): string {
  const cat = categorySlug ?? 'inconnu';
  const t = normalize(title);

  // L'ETAT N'ENTRE PAS DANS LA CLE, et c'est deliberé.
  //
  // Une version anterieure separait les groupes par etat : les boites ouvertes
  // n'etaient donc comparees qu'a d'autres boites ouvertes. Or tout l'interet
  // d'une boite ouverte est son ecart au prix du NEUF ; les comparer entre
  // elles supprime precisement ce qui les rend interessantes. Resultat mesure :
  // 2 produits sur 5 561 depassaient 50 de score.
  //
  // Le groupe melange donc les etats, et c'est le moteur de score qui applique
  // ensuite le rabais NORMALEMENT attendu pour un article ouvert ou remis a
  // neuf (voir CONDITION_EXPECTED_DISCOUNT dans score.ts).
  const parts: string[] = [cat, `t:${typeToken(title, brand)}`];
  void condition;

  // Diagonale d'écran : « 65 po », « 65 pouces », « 65" », « 65-inch ».
  const inches = t.match(/\b(\d{2,3})\s*(?:po\b|pouces?\b|"|''|-?inch)/);
  if (inches) {
    const n = Number(inches[1]);
    if (n >= 10 && n <= 120) {
      // On regroupe par tranche : un 55 et un 58 sont substituables, pas un
      // 43 et un 85. Les tranches suivent les paliers réels du marché.
      const band =
        n <= 32 ? '<=32' : n <= 43 ? '33-43' : n <= 55 ? '44-55' : n <= 65 ? '56-65' : n <= 75 ? '66-75' : '76+';
      parts.push(`po:${band}`);
    }
  }

  // Technologie d'affichage : un OLED et un DEL de même taille ne jouent pas
  // dans la même gamme de prix, les mélanger fausserait la comparaison.
  if (/\boled\b|delo\b/.test(t)) parts.push('panel:oled');
  else if (/qled|\bqd\b|mini-?del|mini-?led/.test(t)) parts.push('panel:qled');

  // RESOLUTION - avec la taille et la dalle, c'est ce qui fait le prix d'un
  // ecran. Sans elle, un 32 po OLED 1440p et un 32 po OLED 4K tombaient dans
  // le meme groupe, et le second paraissait cher pour rien.
  if (/\b(?:uhd|4k|2160p)\b/.test(t)) parts.push('res:4k');
  else if (/\b(?:qhd|1440p|wqhd|uwqhd)\b/.test(t)) parts.push('res:1440');
  else if (/\b(?:fhd|1080p)\b|full ?hd/.test(t)) parts.push('res:1080');

  // FREQUENCE DE RAFRAICHISSEMENT - second facteur de prix des moniteurs de
  // jeu. On regroupe par palier, un 240 Hz et un 280 Hz etant substituables.
  const hz = t.match(/\b(\d{2,3})\s?hz\b/);
  if (hz) {
    const v = Number(hz[1]);
    const band = v <= 75 ? '60' : v <= 120 ? '120' : v <= 180 ? '165' : v <= 260 ? '240' : '360+';
    parts.push(`hz:${band}`);
  }

  // CARTE GRAPHIQUE — le facteur de prix dominant d'un PC de jeu.
  //
  // Sans elle, un RTX 4060 a 1 499 $ et un RTX 5090 a 6 000 $ tombaient dans le
  // meme groupe « ordinateur ». La mediane du groupe montait a 2 640 $, et le
  // 4060 ressortait « 43 % sous la mediane de ses equivalents » — alors qu'il
  // etait simplement moins puissant, pas moins cher.
  const gpu = t.match(/\b(?:rtx|gtx)\s?(\d{4})|\brx\s?(\d{4})\b/);
  if (gpu) {
    const n = Number(gpu[1] ?? gpu[2]);
    // On regroupe par PALIER, pas par modele exact : un 4060 et un 4060 Ti se
    // remplacent l'un l'autre, un 4060 et un 4090 non.
    const tier = Math.floor((n % 1000) / 100); // 4060 -> 0, 4070 -> 0, 4090 -> 0
    const gen = Math.floor(n / 1000);
    const rank = Math.floor((n % 1000) / 10); // 60, 70, 80, 90
    parts.push(`gpu:${gen}-${rank}`);
    void tier;
  }

  // GAMME DE PROCESSEUR — meme logique, pour les machines sans carte dediee.
  const cpu = t.match(/\b(?:core\s?)?i([3579])\b|\bryzen\s?([3579])\b|\bultra\s?([3579])\b/);
  if (cpu && !gpu) parts.push(`cpu:${cpu[1] ?? cpu[2] ?? cpu[3]}`);

  // Stockage, pour l'informatique et le mobile.
  const storage = t.match(/\b(\d{3,4})\s*(?:go|gb)\b|\b(\d{1,2})\s*(?:to|tb)\b/);
  if (storage) {
    const gb = storage[1] ? Number(storage[1]) : Number(storage[2]) * 1024;
    const band = gb <= 128 ? '<=128' : gb <= 256 ? '256' : gb <= 512 ? '512' : gb <= 1024 ? '1to' : '2to+';
    parts.push(`sto:${band}`);
  }

  return parts.join('|');
}

export interface PeerStats {
  /** Position du prix dans son groupe de pairs, 0 = le moins cher. */
  percentile: number;
  /**
   * Prix médian du groupe, calculé sur les articles NEUFS uniquement.
   *
   * C'est la référence contre laquelle tout se mesure, y compris les articles
   * d'occasion : un boîte ouverte vaut quelque chose parce qu'il est moins cher
   * que le neuf, pas parce qu'il est moins cher que d'autres boîtes ouvertes.
   */
  median: number;
  /** Nombre de pairs comparés (le groupe s'inclut lui-même). */
  size: number;
  /** Écart relatif à la médiane du groupe : positif = moins cher. */
  belowMedian: number;
  /**
   * COHÉSION du groupe, 0..1. C'est le garde-fou du signal.
   *
   * Un groupe dont les prix s'étalent de 30 $ à 3 000 $ n'est pas un groupe de
   * pairs : c'est un rayon. Y calculer un « écart à la médiane » revient à
   * comparer des objets non substituables. On mesure donc la dispersion
   * (rapport interquartile) et on fait chuter la cohésion quand elle est trop
   * large ; le moteur de score s'en sert pour TAIRE le signal plutôt que de
   * conclure à tort.
   */
  cohesion: number;
  /**
   * Ce produit est-il un OUTSIDER de son propre groupe ?
   *
   * Cas reel : un haut-parleur encastrable a 59,99 $ dans un groupe dont le
   * premier quartile est a 260 $. Le groupe est pourtant homogene (p75/p25 =
   * 2,3), donc la cohesion ne le detecte pas. Mais un objet situe 4 fois sous
   * le quartile inferieur n'est pas une aubaine du groupe : c'est un objet
   * d'une AUTRE classe, mal range.
   *
   * Conclure « 86 % sous la mediane de ses equivalents » serait faux. On marque
   * donc l'outsider, et le moteur de score se tait a son sujet.
   */
  isOutlier: boolean;
  /**
   * Quantiles du groupe, exposés pour pouvoir juger la PLAUSIBILITÉ d'un prix
   * régulier annoncé. Un « régulier » situé au-dessus de presque tous les
   * produits comparables n'est pas un prix : c'est une fiction destinée à
   * gonfler le rabais affiché.
   */
  p50: number;
  p90: number;
  /** Clé du groupe, conservée pour pouvoir interroger les pairs ensuite. */
  key: string;
}

/**
 * Cohésion mesurée sur les DÉCILES (p90/p10), pas sur les quartiles.
 *
 * Une première version utilisait p75/p25. Défaut constaté sur un cas réel : le
 * groupe « ordinateurs » s'étend de 926 $ à 17 930 $, ce qui n'a rien d'un
 * groupe de produits substituables — mais son rapport interquartile vaut 2,40,
 * donc il était classé « serré ». L'écart interquartile MASQUE les queues de
 * distribution, précisément là où l'hétérogénéité se cache.
 *
 * Le rapport interdécile du même groupe vaut 5,25, et le disqualifie
 * correctement.
 */
const TIGHT_SPREAD = 3;
const LOOSE_SPREAD = 8;

/**
 * Un produit situé plus de N fois sous le premier quartile de son groupe est
 * considéré mal classé plutôt qu'exceptionnellement bon marché.
 */
const OUTLIER_RATIO = 2.5;

const quantile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];

/**
 * Calcule les statistiques de pairs pour TOUS les produits actifs, en une
 * passe. Renvoie une table indexée par product_id.
 *
 * On fait tout en mémoire plutôt qu'en SQL : les groupes sont dérivés du titre,
 * ce que SQLite ne sait pas faire, et 50 000 produits tiennent sans peine.
 */
export function computeAllPeerStats(): Map<number, PeerStats> {
  const rows = db()
    .prepare<
      [],
      {
        id: number;
        category_slug: string | null;
        title: string;
        condition: string;
        brand: string | null;
        current_price: number;
      }
    >(
      `SELECT id, category_slug, title, condition, brand, current_price
         FROM products
        WHERE is_active = 1 AND current_price IS NOT NULL AND current_price > 0`,
    )
    .all();

  // 1. Regrouper
  const groups = new Map<string, Array<{ id: number; price: number; isNew: boolean }>>();

  for (const r of rows) {
    const key = peerKey(r.category_slug, r.title, r.condition, r.brand);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push({ id: r.id, price: r.current_price, isNew: r.condition === 'new' });
  }

  // 2. Calculer la distribution de chaque groupe
  const out = new Map<number, PeerStats>();

  for (const [key, members] of groups) {
    // En dessous de 5 produits, une « distribution » ne veut rien dire : on
    // préfère ne rien affirmer plutôt que d'affirmer sur trois exemples.
    if (members.length < 5) continue;

    const sorted = [...members].sort((a, b) => a.price - b.price);
    const prices = sorted.map((m) => m.price);

    // La référence est le prix du NEUF. Sans article neuf dans le groupe, on se
    // rabat sur l'ensemble : mieux vaut une référence imparfaite que pas de
    // référence du tout.
    const newPrices = sorted.filter((m) => m.isNew).map((m) => m.price);
    const reference = newPrices.length >= 3 ? newPrices : prices;
    const median = reference[Math.floor(reference.length / 2)];

    // Cohésion : un groupe trop étalé n'est pas un groupe de pairs.
    const p10 = quantile(prices, 0.1);
    const p25 = quantile(prices, 0.25);
    const p90 = quantile(prices, 0.9);
    // En dessous de ce seuil, l'article n'appartient probablement pas au groupe.
    const outlierFloor = p25 / OUTLIER_RATIO;
    // Rapport INTERDECILE : il voit les queues que l'interquartile masque.
    const spread = p10 > 0 ? p90 / p10 : Number.POSITIVE_INFINITY;
    const cohesion = Math.min(
      1,
      Math.max(0, (LOOSE_SPREAD - spread) / (LOOSE_SPREAD - TIGHT_SPREAD)),
    );

    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i];
      out.set(m.id, {
        percentile: sorted.length > 1 ? i / (sorted.length - 1) : 0.5,
        median,
        size: sorted.length,
        belowMedian: median > 0 ? (median - m.price) / median : 0,
        cohesion,
        isOutlier: m.price < outlierFloor,
        p50: median,
        p90,
        key,
      });
    }
  }

  return out;
}
