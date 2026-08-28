# Item Finder

Comparateur de rabais qui **vérifie chaque prix** au lieu de croire le prix
barré du marchand, et qui **pondère par la qualité mesurée** du produit.

Le principe tient en une phrase : *un rabais sur un mauvais produit reste un
mauvais achat, et un « −60 % » sur un prix régulier fictif n'est pas un rabais.*

---

## Démarrage

```bash
npm install
npm run db:migrate
npm run crawl -- --store bestbuy-ca --all
npm run enrich -- --store bestbuy-ca --limit 300
npm run dev
```

Le site est sur http://localhost:3000.

### Commandes

| Commande | Rôle |
| --- | --- |
| `npm run crawl -- --store bestbuy-ca` | Relève les prix des rayons à fort volume |
| `npm run crawl -- --store bestbuy-ca --all` | Tous les rayons du magasin |
| `npm run crawl -- --store bestbuy-ca --category televiseurs` | Un seul rayon |
| `npm run crawl -- --store bestbuy-ca --search "airpods"` | Ciblé sur une requête |
| `npm run enrich -- --store bestbuy-ca --limit 300` | Va chercher les infos manquantes |
| `npm run score` | Recalcule les classements (aucune requête réseau) |
| `npm run reference -- --limit 10` | Fourchette de prix sourcée sur le web (**payant**, voir plus bas) |
| `npm run stores` | Tableau de bord console : santé, derniers crawls, top deals |
| `npm run schedule` | Boucle autonome, un cycle toutes les 6 h |
| `npm test` | Tests de non-régression du moteur |

---

## Comment le score est calculé

Le score final va de 0 à 100 et se lit toujours **avec son indice de
confiance**, jamais seul.

```
score = signal_valeur × porte_qualité × ampleur × stock × état × confiance
```

### Quatre signaux indépendants, jamais un seul

C'est le choix d'architecture le plus important du projet. Chaque signal répond
à une question différente, et ils se relaient selon ce qui est disponible : il
n'y a donc **aucun point de défaillance unique** dans l'évaluation.

| Signal | Question posée | Disponible | Fiabilité |
| --- | --- | --- | --- |
| **Historique** | moins cher qu'**avant** ? | après quelques jours | croît avec le temps |
| **Pairs** | moins cher que ses **équivalents** ? | **dès le 1er crawl** | dépend du groupe |
| **Référence** | que disent des **sources citées** ? | rare, sur demande | 0 à 0,45, selon la source |
| **Marchand** | que dit le prix barré ? | toujours | **fixe et basse (0,3)** |

Ils sont combinés par **moyenne pondérée par leur fiabilité respective**. La
conséquence est élégante : le poids se déplace tout seul vers la meilleure
source disponible à mesure que le système accumule des données, sans qu'aucun
seuil n'ait à être codé en dur.

La fiabilité du marchand, elle, ne peut jamais augmenter — contrairement aux
trois autres, on n'a aucun moyen de la vérifier.

### 1. Le signal historique

La référence est **notre médiane pondérée par le temps sur 90 jours**, jamais le
prix barré.

> **Pourquoi « pondérée par le temps » ?**
> La table `price_points` n'enregistre que les *changements*. Un produit à 899 $
> pendant 80 jours puis 799 $ pendant 2 heures produit exactement 2 lignes. Une
> médiane naïve donnerait 849 $ — un prix qui n'a jamais existé — et ferait
> passer un vrai rabais pour du bruit. On pondère donc chaque prix par sa
> **durée**. Voir `src/lib/pricing/stats.ts`.

### 2. Le signal de pairs — la réponse au démarrage à froid

Quand la comparaison dans le **temps** manque, on la remplace par la comparaison
dans l'**espace**. Un 65 po OLED à 1 299 $ pendant que tous ses équivalents sont
entre 1 800 $ et 2 400 $ est manifestement une bonne affaire, et aucun
historique n'est nécessaire pour l'établir.

Le groupe de pairs est bâti sur la catégorie, l'état, la **tête du titre**
(« Haut-parleur… », « Friteuse… », « Téléviseur… ») et les attributs extraits
(diagonale, technologie de dalle, capacité de stockage).

Deux garde-fous, tous deux nés de bugs réels observés en cours de route :

- **Cohésion** — si les prix du groupe s'étalent de 30 $ à 3 000 $, ce n'est pas
  un groupe de pairs, c'est un rayon. Le signal se tait.
- **Détection d'outsider** — un haut-parleur encastrable à 59,99 $ dans un
  groupe dont le premier quartile est à 260 $ n'est pas une aubaine : c'est un
  objet d'une autre classe, mal rangé. Sans ce garde-fou, le site affirmait
  « 86 % sous la médiane de 102 produits équivalents », ce qui était faux.

### 3. Le signal de référence externe — sourcé, jamais mémorisé

`npm run reference -- --limit 10` interroge l'API Claude **avec recherche web
activée** pour retrouver ce que des sources publiques documentent : PDSF
officiel, prix habituel constaté, plus bas prix couvert par un article de deals.

Trois garde-fous structurels, parce que c'est le signal le plus facile à
corrompre :

1. **Recherche web obligatoire** — le modèle doit consulter des pages réelles,
   pas sa mémoire.
2. **Pas d'URL, pas de fait** — le code TypeScript rejette tout résultat sans
   source citée, indépendamment de ce que le modèle affirme. Le prompt rend
   « je n'ai pas trouvé » explicitement acceptable : c'est la réponse attendue
   pour la majorité du catalogue.
3. **Table séparée** — ces valeurs ne rejoignent **jamais** `price_points`. Ce
   sont des estimations sourcées, pas des observations.

> **Pourquoi tant de précautions ?** Un modèle de langage produit une réponse
> plausible même sans source. « Ce téléviseur est descendu à 899 $ en novembre »
> sort avec exactement le même aplomb qu'il soit vérifié ou inventé. C'est la
> couverture éditoriale qui rend ce signal utilisable — et elle n'existe que
> pour les produits vedettes. Les AirPods Pro 2 sont documentés partout ; un
> portable Dell de série, nulle part.

La commande **coûte de l'argent réel** (~0,06 $ US par produit) et demande donc
confirmation explicite avec `--yes`. Elle n'est jamais lancée par
l'ordonnanceur, et ne cible que les produits bien classés dont l'historique
observé est encore trop court pour trancher.

### 4. La détection de faux rabais

- **Prix régulier fictif** — le marchand annonce −40 % mais notre historique dit
  que le prix n'a jamais été plus haut. Pénalité proportionnelle à l'écart.
- **Solde permanent** — un produit affiché « en rabais » plus de 85 % du temps
  n'est pas en rabais : c'est son prix normal.

### 5. La porte de qualité — elle **multiplie**, elle ne s'additionne pas

C'est le point structurel. Si la qualité s'*ajoutait* au rabais, un produit
1,8 étoile à −80 % finirait quand même en tête. En **multipliant** par une porte
comprise entre 0,35 et 1,0, un mauvais produit ne *peut pas* atteindre le
sommet, quel que soit son rabais.

La qualité est estimée par la **borne inférieure de Wilson** sur la binomiale
« recommande / ne recommande pas » :

| Données | Qualité |
| --- | --- |
| 991 sur 1 054 recommandent | **0,93** — preuve massive |
| 1 sur 1 recommande | **0,38** — aucune preuve, aucun crédit |
| 300 sur 1 000 recommandent | **0,28** — preuve massive que c'est mauvais |

Wilson pénalise automatiquement les petits échantillons, sans aucune règle
écrite à la main. C'est ce qui fait que « 5,0 sur 2 avis » ne bat jamais
« 4,6 sur 2 400 avis ».

> Une première version utilisait un a priori bayésien fort (30 avis). Résultat
> mesuré au premier crawl : un produit **1 étoile sur 1 avis** obtenait une
> qualité de **0,81**, parce qu'il héritait presque entièrement de la moyenne
> globale. Correct au sens bayésien, catastrophique en pratique. Wilson produit
> le bon comportement sans réglage arbitraire.

### 6. La confiance

Un score de 80 obtenu au bout de 2 jours n'a pas la même valeur qu'un score de
80 obtenu au bout de 3 mois. L'indice de confiance combine la durée
d'historique, la taille du groupe de pairs, le volume d'avis, le nombre de
changements de prix observés et l'accord entre sources d'enrichissement. Il
**amortit le score final**, pour qu'un score reste comparable dans le temps.

L'interface affiche toujours les deux : le chiffre au centre de la pastille, la
confiance dans l'anneau autour.

---

## Peut-on récupérer l'historique de prix passé ?

Question légitime, posée tôt dans le projet. Réponse mesurée, pas supposée.

**Non, pas de façon générale — et c'est une limite d'information, pas
d'ingénierie.** Si personne n'a enregistré le prix d'un aspirateur le 14 mars
2024, cette donnée n'existe nulle part. Aucun code ne peut la faire apparaître.

Ce qui a été réellement testé :

| Piste | Résultat mesuré |
| --- | --- |
| **Wayback Machine** (API CDX) | Fiche produit Best Buy testée : **0 capture**. Les archives couvrent massivement les pages d'accueil, quasiment pas les fiches produit. |
| **API du marchand** | Vérifié sur Best Buy : aucun champ historique. Uniquement le prix courant et la date de fin de solde. |
| **Keepa / camelcamelcamel** | Vrai historique, mais Amazon seulement, et leurs conditions d'utilisation interdisent le scraping. Keepa propose une API payante. |
| **Demander à un LLM** | **À proscrire.** Un modèle qui « se souvient » qu'un article est descendu à 899 $ en novembre ne consulte aucune base : il génère une valeur plausible. L'injecter produirait un site affichant « plus bas prix depuis 6 mois » sur des chiffres inventés — bien pire que d'admettre qu'on ne sait pas. |

L'infrastructure de backfill existe malgré tout (colonne `source` sur
`price_points`, table `backfill_attempts`, migration 004) et **borne
l'influence** de tout point non observé : un relevé archivé pèse au maximum
10 jours d'intervalle, contre la durée réelle pour un relevé qu'on a nous-mêmes
effectué. Un point archivé dit « le prix valait X à cet instant » ; il ne dit
rien des jours autour.

**C'est précisément pour ça que le signal de pairs existe** : il rend le système
utile dès le premier jour, sans avoir à inventer un passé.

---

## L'enrichissement

Quand une information manque, le système **va la chercher** au lieu de se
rabattre sur une valeur neutre.

| Source | Fiabilité | Apporte |
| --- | --- | --- |
| `bestbuy-detail` | 0,97 | marque, numéro de modèle, fabricant |
| `bestbuy-reviews` | 0,97 | note, volume, histogramme, recommandations |
| `cross-store` | 0,72 | avis d'un autre marchand, via le numéro de modèle |

Le résolveur (`src/lib/enrichment/resolver.ts`) interroge **toutes** les sources
applicables, retient la valeur la mieux soutenue, et **mesure l'accord** entre
elles. Une donnée confirmée par deux sources indépendantes ne vaut pas une
donnée isolée ; une donnée contredite fait *baisser* la confiance au lieu d'être
moyennée en silence.

`cross-store` est déjà branchée mais reste silencieuse tant qu'un seul magasin
est alimenté. Elle prend de la valeur à chaque magasin ajouté, sans qu'aucun
code n'ait à changer.

**Choix de la file d'attente** : on n'enrichit pas 50 000 produits. On enrichit
ceux où l'information manquante *change le résultat* — ceux qui pourraient
atteindre la page d'accueil mais dont la qualité est encore inconnue. C'est la
différence entre un système lourd et un système efficace : dépenser les requêtes
là où elles modifient une décision.

---

## Ajouter un magasin

L'ordre prévu : Best Buy ✅ → IKEA → Walmart → Canadian Tire → Costco → Amazon →
Winners.

### 1. Écrire l'adaptateur

Créer `src/lib/scraping/stores/<magasin>.ts` exportant un `StoreAdapter` :

```ts
export const ikeaAdapter: StoreAdapter = {
  id: 'ikea-ca',
  capabilities: { deals: true, categories: true, search: true },
  categories: Object.keys(CATEGORY_MAP),

  async *listCategory(slug, ctx) {
    // ctx.getJson / ctx.getText sont déjà limités en débit, avec retries
    // et backoff. Émettre des RawProduct au fil de l'eau.
    yield { sku, url, title, price, /* … */ };
  },
};
```

Points à respecter :

- **Générateur asynchrone** : on émet au fil de l'eau, jamais un gros tableau.
  Le moteur écrit par lots de 400 et peut être interrompu proprement.
- **Respecter `ctx.limits`** (`maxPages`, `maxProducts`) et `ctx.signal`.
- **Traduire les rayons du marchand vers les slugs canoniques** de
  `src/lib/categories.ts`. C'est ce qui permet de comparer un produit entre
  magasins — et ce qui alimente le signal de pairs.
- **Ne jamais faire confiance au prix barré** : le renseigner dans `listPrice`,
  le moteur décidera de son poids.
- **Fournir plusieurs `imageUrls`** si le CDN héberge plusieurs résolutions :
  toutes n'existent pas pour chaque article, et l'affichage choisit la taille
  adaptée au contexte.

### 2. L'inscrire au registre

Dans `src/lib/scraping/registry.ts`, brancher `adapter:` sur l'entrée existante.
Le magasin passe automatiquement de « bientôt disponible » à actif dans
l'interface.

### 3. Chercher le plafond de pagination du marchand

**À vérifier systématiquement pour chaque nouveau magasin.** Best Buy annonce
`totalPages: 243` et `total: 24212` sur le rayon « Portables »… mais la page 21
renvoie **zéro produit**. Toute requête est plafonnée à **20 pages, soit 2 000
produits**, quelle que soit la taille réelle du rayon. Le `totalPages` renvoyé
est trompeur.

C'est ce mur qui affichait « 2 000 » sur presque toutes les catégories du site.
Ce n'était pas un réglage de notre côté : c'était le plafond du marchand.

La parade est implémentée de façon **générale** dans `crawlNode()` : quand un
rayon annonce plus de produits que la fenêtre accessible et possède des
sous-rayons, le crawler **descend automatiquement dans l'arborescence**, chaque
sous-rayon disposant de sa propre fenêtre de 2 000. Aucun mapping manuel à
maintenir, et tout nouveau sous-rayon créé par le marchand est pris en compte
tout seul.

Pour trouver ce plafond sur un nouveau magasin : demandez une page très
au-delà de la première (page 25, 50…) et regardez si elle renvoie du vide alors
que `totalPages` prétend le contraire.

### 4. Ajuster le débit

`requestsPerSecond` est volontairement conservateur. Un scraper poli tient des
années ; un scraper agressif se fait bloquer en une après-midi. Le disjoncteur
met de toute façon un magasin en pause après des échecs répétés (5 min, puis 10,
20, 40… jusqu'à 6 h).

---

## Architecture

```
src/
  app/                    Pages Next.js (server components)
    page.tsx              Découvrir
    categories/           Catégories + détail par rayon
    recherche/            Recherche plein texte
    produit/[id]/         Fiche produit + historique de prix
  components/             Cartes, pastille de score, graphique, filtres, images
  lib/
    categories.ts         Taxonomie canonique, indépendante des magasins
    db/
      migrations/         SQL versionné, appliqué en transaction
      queries.ts          Toutes les lectures du site
    scraping/
      types.ts            Contrat StoreAdapter
      registry.ts         Les 7 magasins, actifs ou à venir
      core/http.ts        Débit limité, retries, backoff, jitter
      core/pipeline.ts    Ingestion, historique, disjoncteur
      stores/             Un fichier par magasin
    enrichment/
      resolver.ts         Fusion multi-sources + mesure d'accord
      runner.ts           File de priorité et orchestration
      sources/            Une source par origine de données
    pricing/
      stats.ts            Statistiques pondérées par le temps
      peers.ts            Groupes de produits équivalents
      score.ts            Fusion des trois signaux, borne de Wilson
scripts/                  CLI : crawl, enrich, score, stores, schedule, selftest
data/itemfinder.db        Base SQLite (WAL, FTS5)
```

### Choix techniques

- **SQLite en mode WAL** — le crawler écrit pendant que le site lit, sans
  blocage. Zéro service à administrer.
- **FTS5 avec `remove_diacritics 2`** — « televiseur » trouve « téléviseur ».
  Indispensable pour un site francophone : personne ne tape les accents.
- **Historique append-only, changements uniquement** — un produit stable pendant
  six mois occupe une ligne, pas cent quatre-vingts.
- **Server components** — le catalogue n'est jamais envoyé au navigateur ; les
  filtres sont des URL, donc partageables et fonctionnels sans JavaScript.
- **Images choisies selon le contexte** — une vignette de grille charge le
  500 px, pas le 1500 px. Une première version prenait systématiquement la plus
  grande résolution : 40 cartes faisaient plus de 10 Mo et la page semblait
  cassée le temps du chargement.
- **Historique de recherche en `localStorage`** — ce sont les recherches de *ce*
  navigateur, elles n'ont rien à faire sur le serveur. Chaque accès est protégé,
  car en navigation privée un simple `localStorage.getItem` peut lever.

---

## Tests

`npm test` vérifie les décisions mathématiques dont dépend tout le reste —
celles où une erreur silencieuse produirait des classements faux sans jamais
lever d'exception :

- la médiane est bien pondérée par la durée, pas par le nombre de lignes ;
- Wilson pénalise les petits échantillons de façon monotone ;
- la qualité multiplie (un produit mal noté ne peut pas atteindre le sommet) ;
- un rabais annoncé que l'historique dément est pénalisé ;
- « plus bas jamais vu » exige un minimum de recul ;
- le signal de pairs fonctionne sans aucun historique ;
- un groupe trop étalé, ou un produit hors gabarit, fait taire ce signal.

---

## Limites connues

- **Le démarrage à froid du signal historique est réel.** Il faut quelques
  semaines de crawls réguliers pour qu'il devienne pleinement fiable. Le signal
  de pairs comble ce trou, et la confiance dit honnêtement où on en est.
- **Le signal de pairs compare des produits similaires, pas identiques.** Un
  article moins cher que ses pairs peut simplement être un modèle inférieur. La
  porte de qualité et la détection d'outsider limitent le risque sans l'annuler.
- **Un seul magasin est alimenté** pour l'instant : la comparaison
  inter-marchands et la corroboration croisée restent inactives.
- **L'amortissement « boîte ouverte » (0,82)** est un réglage empirique, à
  réviser avec du recul.
- **La couverture d'enrichissement est partielle.** À 1,2 requête/seconde et
  2 requêtes par produit, couvrir 75 000 articles demande ~34 h de
  fonctionnement continu. La file de priorité traite d'abord les produits
  susceptibles d'atteindre la page d'accueil, mais la longue traîne reste sans
  marque ni preuve de qualité tant que l'ordonnanceur n'a pas tourné longtemps.
- **Le build de production n'a pas été validé** : tout le développement et les
  vérifications ont eu lieu en mode `npm run dev`.
- Les compteurs de catégories indiquent ce que **nous avons indexé**, pas le
  catalogue complet du marchand.
- Vérifiez toujours le prix chez le marchand avant d'acheter : le site reflète
  le dernier passage du crawler, pas l'instant présent.
