/**
 * Tests de non-régression du moteur.
 *
 *   npm test
 *
 * Ces vérifications ne touchent pas le réseau ni la base : ce sont des
 * fonctions pures. Elles protègent les quelques décisions mathématiques dont
 * dépend tout le reste — celles où une erreur silencieuse produirait des
 * classements faux sans jamais lever d'exception.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, type PricePoint } from '../src/lib/pricing/stats';
import { scoreProduct, wilsonLowerBound } from '../src/lib/pricing/score';
import { typeToken, type PeerStats } from '../src/lib/pricing/peers';
import { extractSpecs } from '../src/lib/specs';
import {
  gammeFromDistribution,
  gammeFromRank,
  type Distribution,
} from '../src/lib/quality/components';

const DAY = 86_400_000;
const NOW = Date.parse('2026-06-01T12:00:00Z');

const point = (daysAgo: number, price: number, listPrice: number | null = null): PricePoint => ({
  price,
  listPrice,
  inStock: 1,
  observedAt: NOW - daysAgo * DAY,
});

// ---------------------------------------------------------------------------
// Statistiques pondérées par le temps
// ---------------------------------------------------------------------------

test('la médiane est pondérée par la durée, pas par le nombre de lignes', () => {
  // 899 $ tenu 80 jours, puis 799 $ depuis 2 heures.
  const points: PricePoint[] = [
    point(80, 899),
    { price: 799, listPrice: null, inStock: 1, observedAt: NOW - 2 * 3600_000 },
  ];

  const stats = computeStats(points, 799, 90, NOW)!;

  // Une médiane naïve sur 2 lignes donnerait 849 — un prix jamais pratiqué.
  assert.equal(stats.median, 899, 'la médiane doit refléter le prix réellement tenu');
  assert.ok(stats.percentile < 0.01, 'le prix courant est le plus bas de la fenêtre');
});

test('le percentile mesure la part de TEMPS passée sous le prix courant', () => {
  // 100 $ pendant 30 j, 200 $ pendant 30 j, puis 150 $ aujourd'hui.
  const points = [point(60, 100), point(30, 200), point(0.01, 150)];
  const stats = computeStats(points, 150, 90, NOW)!;

  // Le prix a été sous 150 pendant ~30 j sur ~60 j observés.
  assert.ok(
    stats.percentile > 0.45 && stats.percentile < 0.55,
    `percentile attendu autour de 0,5, obtenu ${stats.percentile.toFixed(3)}`,
  );
});

test('la fenêtre glissante ignore ce qui précède 90 jours', () => {
  const points = [point(200, 50), point(10, 300)];
  const stats = computeStats(points, 300, 90, NOW)!;
  assert.equal(stats.minInWindow, 50, 'le prix ancien couvre encore le début de la fenêtre');
  assert.ok(stats.daysObserved <= 90.01);
});

// ---------------------------------------------------------------------------
// Borne de Wilson
// ---------------------------------------------------------------------------

test('Wilson pénalise les petits échantillons sans règle ad hoc', () => {
  const massif = wilsonLowerBound(991, 1054);
  const anecdotique = wilsonLowerBound(1, 1);
  const mauvais = wilsonLowerBound(300, 1000);

  assert.ok(massif > 0.9, `991/1054 devrait dépasser 0,9 (obtenu ${massif.toFixed(3)})`);
  assert.ok(
    anecdotique < 0.45,
    `1/1 ne doit accorder aucun crédit (obtenu ${anecdotique.toFixed(3)})`,
  );
  assert.ok(mauvais < 0.32, `300/1000 doit rester bas (obtenu ${mauvais.toFixed(3)})`);
  assert.ok(massif > anecdotique, 'la preuve massive doit battre le témoignage isolé');
});

test('Wilson est monotone : plus de preuve à taux égal, meilleure borne', () => {
  assert.ok(wilsonLowerBound(90, 100) > wilsonLowerBound(9, 10));
  assert.ok(wilsonLowerBound(900, 1000) > wilsonLowerBound(90, 100));
});

// ---------------------------------------------------------------------------
// Moteur de score
// ---------------------------------------------------------------------------

const baseInput = {
  currentPrice: 500,
  listPrice: null as number | null,
  inStock: 1 as number | null,
  rating: null as number | null,
  ratingCount: null as number | null,
  condition: 'new',
  points: [point(60, 800), point(30, 800), point(0.5, 500)],
  globalMeanRating: 4.4,
  now: NOW,
};

test('la qualité MULTIPLIE : un mauvais produit ne peut pas atteindre le sommet', () => {
  const excellent = scoreProduct({
    ...baseInput,
    recommendYes: 950,
    recommendTotal: 1000,
  })!;

  const mauvais = scoreProduct({
    ...baseInput,
    recommendYes: 250,
    recommendTotal: 1000,
  })!;

  // Rabais IDENTIQUE, seule la qualité change.
  assert.ok(
    mauvais.score < excellent.score * 0.55,
    `un produit mal noté doit être largement distancé ` +
      `(mauvais ${mauvais.score.toFixed(1)} vs excellent ${excellent.score.toFixed(1)})`,
  );
});

test('un rabais annoncé que l’historique dément est pénalisé', () => {
  // Le marchand annonce 1000 -> 500, mais le prix vaut 500 depuis 60 jours.
  const faux = scoreProduct({
    ...baseInput,
    currentPrice: 500,
    listPrice: 1000,
    points: [point(60, 500), point(30, 500)],
    recommendYes: 900,
    recommendTotal: 1000,
  })!;

  assert.ok(faux.fakeDealPenalty > 0, 'le faux rabais doit être détecté');
  assert.ok(
    faux.score < 30,
    `un rabais fictif ne doit pas produire un bon score (obtenu ${faux.score.toFixed(1)})`,
  );
});

test('« plus bas jamais vu » exige un minimum de recul', () => {
  // Deux relevés à quelques heures d'intervalle : vrai au sens littéral,
  // trompeur en pratique. Le badge ne doit pas se déclencher.
  const tropJeune = scoreProduct({
    ...baseInput,
    points: [
      { price: 520, listPrice: null, inStock: 1, observedAt: NOW - 6 * 3600_000 },
      { price: 500, listPrice: null, inStock: 1, observedAt: NOW - 3600_000 },
    ],
  })!;
  assert.equal(tropJeune.isLowestEver, false, 'trop peu de recul pour annoncer un plancher');

  const etabli = scoreProduct({
    ...baseInput,
    points: [point(40, 800), point(20, 700), point(1, 500)],
  })!;
  assert.equal(etabli.isLowestEver, true, 'avec du recul, le plancher est annonçable');
});

test('la confiance croît avec la durée d’historique', () => {
  const jeune = scoreProduct({
    ...baseInput,
    points: [point(1, 800), point(0.5, 500)],
  })!;
  const mur = scoreProduct({
    ...baseInput,
    points: [point(80, 800), point(40, 800), point(2, 500)],
  })!;

  assert.ok(
    mur.confidence > jeune.confidence,
    `un historique long doit inspirer plus confiance ` +
      `(${mur.confidence.toFixed(2)} vs ${jeune.confidence.toFixed(2)})`,
  );
});

test('une rupture de stock écrase le score', () => {
  const dispo = scoreProduct({ ...baseInput, recommendYes: 900, recommendTotal: 1000 })!;
  const rupture = scoreProduct({
    ...baseInput,
    inStock: 0,
    recommendYes: 900,
    recommendTotal: 1000,
  })!;
  assert.ok(rupture.score < dispo.score * 0.4, 'un deal inachetable vaut peu');
});

test('la boîte ouverte est tempérée, pas exclue', () => {
  const neuf = scoreProduct({ ...baseInput, recommendYes: 900, recommendTotal: 1000 })!;
  const ouvert = scoreProduct({
    ...baseInput,
    condition: 'open-box',
    recommendYes: 900,
    recommendTotal: 1000,
  })!;

  assert.ok(ouvert.score < neuf.score, 'le risque supplémentaire doit se voir');
  assert.ok(ouvert.score > neuf.score * 0.7, 'mais une bonne affaire reste une bonne affaire');
});

// ---------------------------------------------------------------------------
// Comparaison par pairs
// ---------------------------------------------------------------------------

test('le type de produit est extrait de la tête du titre', () => {
  assert.equal(typeToken('Haut-parleur de plafond encastrable 6,5 po R1650C', 'Klipsch'), 'haut-parleur');
  assert.equal(typeToken('Friteuse à air chaud mince numérique Pro', 'Bella Pro'), 'friteuse');
  assert.equal(typeToken('Téléviseur intelligent Tizen HDR de 65 po', 'Samsung'), 'televiseur');
  // Quand le titre commence par la marque, on prend le mot suivant.
  assert.equal(typeToken('Apple MacBook Air 13,3 po', 'Apple'), 'macbook');
  // Les préfixes d'état ne doivent pas devenir le type.
  assert.equal(typeToken('Boîte ouverte - Téléviseur intelligent', 'LG'), 'televiseur');
});

const peer = (o: Partial<PeerStats>): PeerStats => ({
  percentile: 0.1,
  median: 1000,
  size: 60,
  belowMedian: 0.4,
  cohesion: 1,
  isOutlier: false,
  p50: 1000,
  p90: 1600,
  key: 'test',
  ...o,
});

test('le signal de pairs fonctionne SANS aucun historique', () => {
  // Un seul relevé : le moteur d'historique est muet, les pairs doivent parler.
  const seul = [point(0.02, 600)];

  const sansPairs = scoreProduct({ ...baseInput, points: seul, peer: null })!;
  const avecPairs = scoreProduct({ ...baseInput, points: seul, peer: peer({}) })!;

  assert.ok(
    avecPairs.score > sansPairs.score,
    'la comparaison aux équivalents doit apporter du signal dès le jour 1',
  );
  assert.ok(
    avecPairs.confidence > sansPairs.confidence,
    'et faire monter la confiance, pas seulement le score',
  );
});

test('un groupe trop étalé fait taire le signal', () => {
  const seul = [point(0.02, 600)];
  const groupeSerre = scoreProduct({ ...baseInput, points: seul, peer: peer({ cohesion: 1 }) })!;
  const groupeEtale = scoreProduct({ ...baseInput, points: seul, peer: peer({ cohesion: 0 }) })!;

  assert.ok(
    groupeEtale.score < groupeSerre.score,
    'des prix allant de 30 $ à 3 000 $ ne forment pas un groupe comparable',
  );
});

test('un produit hors gabarit de son groupe ne décroche pas de bonus', () => {
  // Cas réel : haut-parleur encastrable à 59,99 $ dans un groupe dont le
  // premier quartile est à 260 $. Ce n'est pas une aubaine, c'est un objet
  // d'une autre classe, mal rangé.
  const seul = [point(0.02, 60)];
  const normal = scoreProduct({ ...baseInput, points: seul, peer: peer({ belowMedian: 0.86 }) })!;
  const outsider = scoreProduct({
    ...baseInput,
    points: seul,
    peer: peer({ belowMedian: 0.86, isOutlier: true }),
  })!;

  assert.ok(
    outsider.score < normal.score,
    "un outsider ne doit pas être crédité d'un écart qu'il ne mérite pas",
  );
  assert.equal(
    outsider.reasons.some((r) => r.includes('équivalents')),
    false,
    'et le site ne doit surtout pas affirmer une comparaison invalide',
  );
});

test('les trois signaux se relaient au lieu de dépendre d’un seul', () => {
  // Aucun historique, aucun pair, aucun prix barré : le score doit être bas
  // mais le calcul ne doit pas planter.
  const rien = scoreProduct({
    ...baseInput,
    listPrice: null,
    points: [point(0.02, 500)],
    peer: null,
  })!;
  assert.ok(Number.isFinite(rien.score), 'le moteur doit rester défini sans aucun signal');
  assert.ok(rien.score < 25, 'et rester modeste quand il ne sait rien');
});

test('un prix « régulier » hors marché est démasqué SANS historique', () => {
  // Cas réel : PC de jeu à 1 499 $ annoncé « régulier 2 999 $ ». Les machines
  // comparables plafonnent autour de 1 900 $ ; 2 999 $ n'est pas un prix, c'est
  // une fiction. Le « rabais » ramène simplement la machine à sa valeur réelle.
  const sansHistorique = [point(0.02, 1499)];

  const faux = scoreProduct({
    ...baseInput,
    currentPrice: 1499,
    listPrice: 2999,
    points: sansHistorique,
    peer: peer({ size: 200, p50: 1450, p90: 1900, median: 1450, belowMedian: -0.03, percentile: 0.5 }),
    recommendYes: 110,
    recommendTotal: 115,
  })!;

  assert.ok(
    faux.fakeDealPenalty > 0,
    'le prix régulier implausible doit être détecté dès le premier jour',
  );
  assert.ok(
    faux.score < 35,
    `un faux rabais ne doit pas passer pour une bonne affaire (obtenu ${faux.score.toFixed(1)})`,
  );
  assert.ok(
    faux.reasons.some((r) => r.includes('régulier')),
    "et le site doit dire pourquoi il n'y croit pas",
  );
});

test('un vrai rabais reste reconnu malgré le même contrôle', () => {
  // Même structure, mais le « régulier » est cohérent avec le marché et le prix
  // soldé passe nettement sous la médiane des équivalents : vraie affaire.
  const vrai = scoreProduct({
    ...baseInput,
    currentPrice: 999,
    listPrice: 1500,
    points: [point(0.02, 999)],
    peer: peer({ size: 200, p50: 1450, p90: 1900, median: 1450, belowMedian: 0.31, percentile: 0.12 }),
    recommendYes: 110,
    recommendTotal: 115,
  })!;

  assert.equal(vrai.fakeDealPenalty, 0, 'un régulier plausible ne doit pas être pénalisé');
  assert.ok(vrai.score > 45, `une vraie affaire doit ressortir (obtenu ${vrai.score.toFixed(1)})`);
});

// ---------------------------------------------------------------------------
// Analyse par composante
// ---------------------------------------------------------------------------

const dist = (d: Partial<Distribution>): Distribution => ({
  n: 500,
  p10: 10,
  p25: 20,
  p50: 30,
  p75: 40,
  p90: 50,
  ...d,
});

const specDe = (titre: string, categorie: string | null, famille: string) => {
  const s = extractSpecs(titre, null, categorie).find((x) => x.family === famille);
  return s;
};

test('etre exactement dans la mediane n’est jamais etre en dessous', () => {
  // Cas reel : chez les portables, p25 et p50 valent tous deux 144 Hz. Une
  // comparaison « v <= p25 » classait alors un ecran parfaitement median en
  // entree de gamme.
  const serree = dist({ p25: 144, p50: 144, p75: 165, p90: 240 });
  const r = gammeFromDistribution(
    { label: '144 Hz', effect: '', group: 'image', family: 'rafraichissement', metric: 144 },
    serree,
  );
  assert.equal(r.gamme, 'milieu', 'la mediane doit rester le milieu de gamme');
});

test('une valeur basse est un atout quand moins vaut mieux', () => {
  const bruit = dist({ p10: 40, p25: 44, p50: 50, p75: 55, p90: 60 });
  const base = { label: '', effect: '', group: 'usage' as const, family: 'bruit', lowerIsBetter: true };

  assert.equal(gammeFromDistribution({ ...base, metric: 38 }, bruit).gamme, 'premium');
  assert.equal(gammeFromDistribution({ ...base, metric: 58 }, bruit).gamme, 'entree');
  assert.equal(gammeFromDistribution({ ...base, metric: 50 }, bruit).gamme, 'milieu');
});

test('une echelle a deux echelons ne produit pas de « tres haut de gamme »', () => {
  // Un SSD est un bon point, pas un sommet : sans ce garde-fou, toute presence
  // binaire ressortait au meme rang qu’une dalle OLED.
  const r = gammeFromRank({
    label: 'Stockage SSD',
    effect: '',
    group: 'performance',
    family: 'stockage-type',
    rank: 2,
    scale: 2,
  });
  assert.equal(r.gamme, 'haut');
});

test('un materiau ne se juge que la ou il decrit le produit', () => {
  const casserole = specDe('Poele en aluminium 12 po', 'cuisine', 'materiau');
  assert.ok(casserole, 'la matiere doit compter pour un article de cuisine');

  const portable = specDe('Portable 14 po en aluminium d’Apple', 'portables', 'materiau');
  assert.equal(
    portable,
    undefined,
    'une coque en aluminium ne classe pas un ordinateur en milieu de gamme',
  );

  const inconnue = specDe('Poele en aluminium 12 po', null, 'materiau');
  assert.equal(inconnue, undefined, 'sans categorie, on prefere se taire');
});

test('des pouces ne sont une diagonale que s’il y a un ecran', () => {
  assert.match(specDe('Televiseur 65 po', 'televiseurs', 'diagonale')!.label, /^Diagonale/);
  assert.match(specDe('Hotte de 30 po', 'gros-electro', 'diagonale')!.label, /^Format/);
});

test('un Bluetooth sans version annoncee n’est pas classe', () => {
  const sansVersion = specDe('Casque Bluetooth sans fil', 'casques', 'bluetooth');
  assert.ok(sansVersion, 'la caracteristique reste affichee');
  assert.equal(sansVersion!.rank, undefined, 'ne rien savoir n’est pas etre en bas de gamme');

  const avec = specDe('Casque Bluetooth 5.3 sans fil', 'casques', 'bluetooth');
  assert.equal(avec!.rank, 3);
});

test('une capacite en pieds cubes est bien extraite', () => {
  // La regle finissait par « pi[3]\b ». « ³ » n'etant pas un caractere de mot,
  // cette frontiere exigeait une lettre juste apres — or il y a une espace.
  // Aucun produit ne matchait, sans la moindre erreur nulle part.
  const s = extractSpecs(
    'Refrigerateur a deux portes de 31,7 pi³ et 36 po de LG',
    null,
    'gros-electro',
  ).find((x) => x.family === 'capacite');

  assert.ok(s, 'la capacite doit etre reconnue');
  assert.equal(s!.metric, 31.7);
  assert.equal(s!.unit, 'pi3');
});
