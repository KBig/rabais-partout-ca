/**
 * Caractéristiques techniques, et surtout CE QU'ELLES CHANGENT.
 *
 * ----------------------------------------------------------------------------
 * POURQUOI EXPLIQUER PLUTÔT QUE LISTER
 * ----------------------------------------------------------------------------
 *
 * « 240 Hz » ne dit rien à qui ne sait pas déjà ce qu'est un taux de
 * rafraîchissement. Une fiche qui aligne des sigles suppose que le lecteur
 * connaît déjà la réponse à sa propre question — ce qui est rarement le cas
 * quand on compare deux produits.
 *
 * Chaque caractéristique porte donc une phrase disant ce qu'elle apporte
 * concrètement. Le but n'est pas de faire de la pédagogie : c'est de permettre
 * de décider. Savoir que le 240 Hz sert au jeu rapide, c'est savoir s'il faut
 * payer pour, ou pas.
 *
 * ----------------------------------------------------------------------------
 * POURQUOI PAS UN MODÈLE DE LANGAGE
 * ----------------------------------------------------------------------------
 *
 * Ces explications sont des faits stables : le 4K aura toujours quatre fois
 * plus de pixels que le 1080p. Les écrire une fois coûte zéro, ne varie jamais,
 * et ne peut pas halluciner. Générer 200 000 explications par API coûterait
 * cher et produirait des formulations différentes pour un même fait.
 */

export interface Spec {
  /** Étiquette courte, affichée en gras. */
  label: string;
  /** Ce que ça change pour l'acheteur, en une phrase. */
  effect: string;
  /** Regroupement pour l'affichage. */
  group: 'image' | 'performance' | 'audio' | 'usage' | 'connectivite';
  /** Famille, reportée depuis la règle : sert au classement par gamme. */
  family: string;

  /**
   * POSITION SUR UNE ÉCHELLE CONNUE, quand il en existe une.
   *
   * Une dalle OLED est meilleure qu'une QLED, un Ryzen 9 qu'un Ryzen 3 : ce
   * sont des ordres établis, pas des opinions. On les écrit une fois.
   */
  rank?: number;
  /** Nombre d'échelons de cette échelle, pour situer `rank`. */
  scale?: number;

  /**
   * VALEUR NUMÉRIQUE COMPARABLE, quand aucune échelle absolue n'existe.
   *
   * « 16 Go » n'est ni bon ni mauvais dans l'absolu : tout dépend de ce que
   * fait le reste du marché. Cette valeur est confrontée à la distribution
   * réelle de sa catégorie, mesurée sur le catalogue.
   */
  metric?: number;
  /** Unité, qui fait partie de la clé : des litres ne se comparent pas à des pi³. */
  unit?: string;
  /** Vrai quand une valeur BASSE est meilleure (temps de réponse). */
  lowerIsBetter?: boolean;
}

export interface SpecRule {
  /**
   * FAMILLE de la caracteristique. Une seule regle par famille est retenue.
   *
   * Sans cet identifiant explicite, la deduplication comparait les etiquettes
   * affichees : « Dalle QD-OLED » et « Dalle OLED » etant des chaines
   * differentes, les deux apparaissaient sur la meme fiche alors qu'elles
   * decrivent la meme dalle. Les regles etant ordonnees du plus precis au plus
   * general, la premiere qui matche est la bonne.
   */
  family: string;
  /** Testé sur le titre + la description, accents retirés, en minuscules. */
  match: RegExp;
  /** Construit la caractéristique à partir de la correspondance. */
  build: (m: RegExpMatchArray) => Omit<Spec, 'family'>;

  /** Échelon occupé sur l'échelle de la famille (1 = le plus bas). */
  rank?: number | ((m: RegExpMatchArray) => number | undefined);
  /** Hauteur de l'échelle. Identique pour toutes les règles d'une famille. */
  scale?: number;
  /** Extrait la valeur à comparer au marché. */
  metric?: (m: RegExpMatchArray) => number;
  unit?: string;
  lowerIsBetter?: boolean;

  /**
   * Categories ou la regle a un sens.
   *
   * « Aluminium » sur une casserole decrit ce qu'est l'objet ; sur un portable,
   * ca ne decrit que la coque, et le classer « milieu de gamme » pour autant
   * serait faux. Une regle qui ne s'applique pas partout doit le dire.
   */
  onlyIn?: ReadonlySet<string>;
}

/**
 * Categories ou une mesure en pouces designe VRAIMENT une diagonale d'ecran.
 *
 * Ailleurs, « 30 po » est une largeur — celle d'une hotte, d'un meuble, d'un
 * grill. L'appeler « diagonale » serait une affirmation fausse sur un produit
 * qui n'a pas d'ecran.
 */
const CATEGORIES_ECRAN: ReadonlySet<string> = new Set([
  'televiseurs', 'moniteurs', 'portables', 'ordinateurs', 'tablettes',
  'telephones', 'telephones-forfait', 'pc-gaming', 'realite-virtuelle',
]);

/** Gros et petits electromenagers : la ou les fonctions de cuisson et de froid comptent. */
const CATEGORIES_ELECTRO: ReadonlySet<string> = new Set([
  'gros-electro', 'petits-electro', 'cuisine', 'aspirateurs',
]);

/** Outillage et jardin : tension de batterie, type de moteur. */
const CATEGORIES_OUTILS: ReadonlySet<string> = new Set(['outils', 'jardinage', 'auto', 'pieces-auto']);

/** Soins et beaute : les contenances se comparent, les formats aussi. */
const CATEGORIES_BEAUTE: ReadonlySet<string> = new Set([
  'beaute-sante', 'beaute-corps', 'soins-cheveux', 'soins-dentaires', 'bien-etre',
]);

/** Jeux et jouets : nombre de joueurs, age, duree. */
const CATEGORIES_JEUX: ReadonlySet<string> = new Set([
  'jeux-societe', 'jouets', 'jouets-enfants', 'jouets-exterieur', 'lego', 'modelisme', 'bebe',
]);

/**
 * Categories ou la matiere EST le produit : vaisselle, cuisson, mobilier,
 * rangement. Ailleurs, le materiau cite dans un titre ne decrit qu'un detail
 * de finition.
 */
const CATEGORIES_MATIERE: ReadonlySet<string> = new Set([
  'cuisine', 'salle-a-manger', 'petits-electro', 'gros-electro', 'meubles',
  'salon', 'chambre', 'bureau-meubles', 'rangement', 'rangement-bureau',
  'decoration', 'literie', 'luminaires', 'jardinage', 'outils', 'animaux',
  'habitat-animaux', 'accessoires-animaux', 'bebe', 'mobilier-bebe', 'bagages',
  'sport', 'fitness', 'montres-mode', 'bijoux', 'accessoires-mode', 'vetements',
])

export const RULES: SpecRule[] = [
  // ------------------------------------------------------------------ image
  {
    family: 'resolution',
    match: /\b(?:8k)\b/,
    rank: 4,
    scale: 4,
    build: () => ({
      group: 'image',
      label: 'Résolution 8K',
      effect:
        'Quatre fois plus de pixels que le 4K. Très peu de contenu existe à ce format aujourd’hui.',
    }),
  },
  {
    family: 'resolution',
    match: /\b(?:uhd|4k|2160p)\b/,
    rank: 3,
    scale: 4,
    build: () => ({
      group: 'image',
      label: 'Résolution 4K',
      effect:
        'Quatre fois plus de pixels que le 1080p : les détails et le texte restent nets, même de près ou sur grand écran.',
    }),
  },
  {
    family: 'resolution',
    match: /\b(?:qhd|wqhd|uwqhd|1440p)\b/,
    rank: 2,
    scale: 4,
    build: () => ({
      group: 'image',
      label: 'Résolution 1440p',
      effect:
        'Entre le 1080p et le 4K. Plus net que le 1080p, tout en demandant beaucoup moins de puissance que le 4K.',
    }),
  },
  {
    family: 'resolution',
    match: /\b(?:fhd|1080p)\b|full ?hd/,
    rank: 1,
    scale: 4,
    build: () => ({
      group: 'image',
      label: 'Résolution 1080p',
      effect:
        'Le standard courant. Suffisant sur un petit écran ou à distance ; l’image paraît moins fine sur grande diagonale.',
    }),
  },
  {
    family: 'dalle',
    match: /\b(?:qd[- ]?oled|qd[- ]?delo)\b/,
    rank: 4,
    scale: 4,
    build: () => ({
      group: 'image',
      label: 'Dalle QD-OLED',
      effect:
        'Chaque pixel s’éteint complètement : noirs absolus et contraste très supérieur au DEL, avec des couleurs plus vives que l’OLED classique.',
    }),
  },
  {
    family: 'dalle',
    match: /\b(?:oled|delo)\b/,
    rank: 4,
    scale: 4,
    build: () => ({
      group: 'image',
      label: 'Dalle OLED',
      effect:
        'Chaque pixel produit sa propre lumière et peut s’éteindre : les noirs sont parfaits et le contraste bien meilleur qu’un écran rétroéclairé.',
    }),
  },
  {
    family: 'dalle',
    match: /mini[- ]?(?:del|led)/,
    rank: 3,
    scale: 4,
    build: () => ({
      group: 'image',
      label: 'Rétroéclairage mini-DEL',
      effect:
        'Des milliers de zones lumineuses contrôlées séparément : contraste proche de l’OLED, avec une luminosité plus élevée en pleine lumière.',
    }),
  },
  {
    family: 'dalle',
    match: /\bqled\b/,
    rank: 2,
    scale: 4,
    build: () => ({
      group: 'image',
      label: 'Dalle QLED',
      effect:
        'Un filtre à points quantiques élargit les couleurs et monte plus haut en luminosité qu’un DEL ordinaire. Le noir reste moins profond qu’en OLED.',
    }),
  },
  {
    family: 'rafraichissement',
    match: /\b(\d{2,3})\s?hz\b/,
    metric: (m) => Number(m[1]),
    unit: 'Hz',
    build: (m) => {
      const hz = Number(m[1]);
      return {
        group: 'image',
        label: `${hz} Hz`,
        effect:
          hz >= 200
            ? `L’image se rafraîchit ${hz} fois par seconde. En jeu rapide, le mouvement reste net là où un écran 60 Hz devient flou.`
            : hz >= 120
              ? `L’image se rafraîchit ${hz} fois par seconde : mouvements nettement plus fluides qu’en 60 Hz, en jeu comme au défilement.`
              : `Taux de rafraîchissement standard. Convient au visionnement ; les joueurs exigeants préfèrent 120 Hz ou plus.`,
      };
    },
  },
  {
    family: 'reponse',
    match: /\b(0[,.]\d{1,2})\s?ms\b/,
    metric: (m) => Number(m[1].replace(',', '.')),
    unit: 'ms',
    // Un temps de reponse plus COURT est meilleur : l'echelle s'inverse.
    lowerIsBetter: true,
    build: (m) => ({
      group: 'image',
      label: `Temps de réponse ${m[1]} ms`,
      effect:
        'Les pixels changent de couleur presque instantanément : pas de traînée derrière les objets en mouvement.',
    }),
  },
  {
    family: 'hdr',
    match: /\bhdr\s?(?:10\+?|1000|400|600)?\b/,
    build: () => ({
      group: 'image',
      label: 'HDR',
      effect:
        'Écart plus large entre les zones sombres et lumineuses : un ciel reste éclatant sans écraser les ombres.',
    }),
  },
  {
    family: 'courbure',
    match: /\bincurv[ée]\b|\bcurved\b/,
    build: () => ({
      group: 'image',
      label: 'Écran incurvé',
      effect:
        'Les bords se rapprochent des yeux. Utile sur un grand écran à courte distance ; sans intérêt à plusieurs mètres.',
    }),
  },
  {
    family: 'diagonale',
    onlyIn: CATEGORIES_ECRAN,
    match: /\b(\d{2,3})\s*(?:po|pouces?)\b/,
    metric: (m) => Number(m[1]),
    unit: 'po',
    build: (m) => ({
      group: 'image',
      label: `Diagonale ${m[1]} po`,
      effect: `Mesurée en diagonale, coin à coin. Compte autant que la résolution : plus l’écran est grand, plus il faut de pixels pour rester net.`,
    }),
  },
  {
    // Hors ecran, la meme mesure existe et reste utile — c'est un encombrement.
    family: 'diagonale',
    match: /\b(\d{2,3})\s*(?:po|pouces?)\b/,
    metric: (m) => Number(m[1]),
    unit: 'po',
    build: (m) => ({
      group: 'usage',
      label: `Format ${m[1]} po`,
      effect:
        'Dimension principale de l’appareil. À vérifier contre l’espace disponible avant tout le reste : un modèle qui ne rentre pas ne sert à rien.',
    }),
  },

  // ------------------------------------------------------------ performance
  //
  // La MARQUE du processeur est une famille a part entiere.
  //
  // « Core i7 » dit le niveau de gamme, pas le fabricant — et c'est le
  // fabricant qu'on veut pouvoir filtrer : quelqu'un qui cherche de l'AMD ne
  // veut pas parcourir les i7 pour trouver les Ryzen.
  {
    family: 'cpu-marque',
    match: /\bryzen\b|\bathlon\b|\bamd\s(?:fx|a\d)\b/,
    build: () => ({
      group: 'performance',
      label: 'Processeur AMD',
      effect:
        'AMD offre en general plus de coeurs a prix egal : avantage au travail qui sait les utiliser, montage video ou compilation.',
    }),
  },
  {
    family: 'cpu-marque',
    match: /\bcore\s?(?:ultra\s?)?[i3579]|\bintel\b|\bceleron\b|\bpentium\b|\bxeon\b/,
    build: () => ({
      group: 'performance',
      label: 'Processeur Intel',
      effect:
        'Intel domine encore les taches qui ne tirent parti que d\u2019un ou deux coeurs, et sa compatibilite logicielle est la plus large.',
    }),
  },
  {
    family: 'cpu-marque',
    match: /\bpuce\s?m[1234]\b|\bapple\s?m[1234]\b|\bm[1234]\s?(?:pro|max|ultra)\b/,
    build: () => ({
      group: 'performance',
      label: 'Puce Apple Silicon',
      effect:
        'Processeur maison d\u2019Apple : autonomie et silence tres au-dessus de la moyenne, mais reserve a macOS.',
    }),
  },
  {
    family: 'cpu-marque',
    match: /\bsnapdragon\b|\bmediatek\b|\bexynos\b/,
    build: () => ({
      group: 'performance',
      label: 'Processeur ARM mobile',
      effect:
        'Concu pour la basse consommation. Excellente autonomie ; certains logiciels de bureau ne tournent qu\u2019en emulation.',
    }),
  },
  {
    family: 'gpu',
    match: /\bradeon\s?rx\s?(\d{3,4})/,
    rank: (m) => {
      const rang = Number(m[1]) % 100;
      return rang >= 80 ? 4 : rang >= 70 ? 3 : rang >= 60 ? 2 : 1;
    },
    scale: 4,
    build: (m) => ({
      group: 'performance',
      label: `Carte graphique Radeon RX ${m[1]}`,
      effect:
        'Carte AMD. A puissance comparable, souvent moins chere qu\u2019une NVIDIA, avec un meilleur rapport memoire/prix mais un ray tracing en retrait.',
    }),
  },
  {
    family: 'gpu',
    match: /\bintel\s?arc\s?[ab](\d{3})/,
    rank: 1,
    scale: 4,
    build: (m) => ({
      group: 'performance',
      label: `Carte graphique Intel Arc ${m[1]}`,
      effect:
        'Carte d\u2019entree de gamme d\u2019Intel. Convient au jeu en 1080p et a l\u2019encodage video, moins aux titres exigeants.',
    }),
  },
  {
    family: 'gpu-marque',
    match: /\b(?:rtx|gtx|geforce)\b|\bnvidia\b/,
    build: () => ({
      group: 'performance',
      label: 'Graphiques NVIDIA',
      effect:
        'Le plus repandu en jeu, et le mieux servi par les logiciels de creation et d\u2019intelligence artificielle.',
    }),
  },
  {
    family: 'gpu-marque',
    match: /\bradeon\b/,
    build: () => ({
      group: 'performance',
      label: 'Graphiques AMD Radeon',
      effect: 'Bon rapport puissance-prix en jeu ; support logiciel plus limite en creation.',
    }),
  },
  {
    family: 'gpu-marque',
    match: /graphiques? int[ée]gr[ée]s?|\biris xe\b|\buhd graphics\b/,
    build: () => ({
      group: 'performance',
      label: 'Graphiques integres',
      effect:
        'Aucune carte dediee : suffisant pour la bureautique et la video, insuffisant pour le jeu recent ou la 3D.',
    }),
  },
  {
    family: 'gpu',
    match: /\b(?:rtx|gtx)\s?(\d{4})/,
    // Le dernier couple de chiffres donne le positionnement dans la gamme :
    // x090 et x080 en haut, x050 en bas. C'est la convention du fabricant.
    rank: (m) => {
      const rang = Number(m[1]) % 100;
      return rang >= 80 ? 4 : rang >= 70 ? 3 : rang >= 60 ? 2 : 1;
    },
    scale: 4,
    build: (m) => {
      const n = Number(m[1]);
      const rang = n % 100;
      return {
        group: 'performance',
        label: `Carte graphique RTX ${n}`,
        effect:
          rang >= 80
            ? 'Carte haut de gamme : jeu en 4K à haut taux d’images, et travail 3D ou vidéo exigeant.'
            : rang >= 70
              ? 'Carte de milieu-haut de gamme : confortable en 1440p, capable de 4K dans la plupart des jeux.'
              : 'Carte d’entrée-milieu de gamme : très bien en 1080p et 1440p, plus juste en 4K.',
      };
    },
  },
  {
    family: 'cpu',
    match: /\bryzen\s?([3579])\b/,
    rank: (m) => (Number(m[1]) - 1) / 2,
    scale: 4,
    build: (m) => ({
      group: 'performance',
      label: `Processeur Ryzen ${m[1]}`,
      effect:
        Number(m[1]) >= 7
          ? 'Processeur puissant : montage vidéo, compilation, jeu exigeant sans goulot d’étranglement.'
          : 'Processeur équilibré : bureautique, navigation et jeu courant sans difficulté.',
    }),
  },
  {
    family: 'cpu',
    match: /\b(?:core\s?)?i([3579])[\s-]/,
    rank: (m) => (Number(m[1]) - 1) / 2,
    scale: 4,
    build: (m) => ({
      group: 'performance',
      label: `Processeur Core i${m[1]}`,
      effect:
        Number(m[1]) >= 7
          ? 'Processeur puissant : montage vidéo, compilation, jeu exigeant sans goulot d’étranglement.'
          : 'Processeur équilibré : bureautique, navigation et jeu courant sans difficulté.',
    }),
  },
  {
    family: 'ram',
    match: /\b(?:ram|m[ée]moire)\s*(?:de\s*)?(\d{1,3})\s*(?:go|gb)\b|\b(\d{1,3})\s*(?:go|gb)\s*(?:de\s*)?(?:ram|ddr\d)/,
    metric: (m) => Number(m[1] ?? m[2]),
    unit: 'Go',
    build: (m) => {
      const go = Number(m[1] ?? m[2]);
      return {
        group: 'performance',
        label: `Mémoire vive ${go} Go`,
        effect:
          go >= 32
            ? 'Large marge : montage vidéo, machines virtuelles, dizaines d’onglets sans ralentissement.'
            : go >= 16
              ? 'Confortable pour le jeu et le travail courant avec beaucoup d’onglets ouverts.'
              : 'Suffisant pour la navigation et la bureautique ; devient juste en multitâche lourd.',
      };
    },
  },
  {
    family: 'stockage-type',
    match: /\b(?:ssd|nvme)\b/,
    rank: 2,
    scale: 2,
    build: () => ({
      group: 'performance',
      label: 'Stockage SSD',
      effect:
        'Aucune pièce mobile : démarrage et ouverture des logiciels en quelques secondes, bien plus rapide qu’un disque mécanique.',
    }),
  },
  {
    family: 'stockage-taille',
    match: /\b(\d)\s*(?:to|tb)\b/,
    metric: (m) => Number(m[1]),
    unit: 'To',
    build: (m) => ({
      group: 'performance',
      label: `Capacité ${m[1]} To`,
      effect: `Environ ${Number(m[1]) * 20} jeux récents, ou des dizaines de milliers de photos.`,
    }),
  },

  // ------------------------------------------------------------------ audio
  {
    family: 'reduction-bruit',
    match: /suppression (?:active )?du bruit|r[ée]duction de bruit|\banc\b/,
    build: () => ({
      group: 'audio',
      label: 'Réduction de bruit active',
      effect:
        'Des micros captent le bruit ambiant et le neutralisent. Très efficace sur les sons continus : avion, métro, ventilation.',
    }),
  },
  {
    family: 'audio-spatial',
    match: /\bdolby atmos\b/,
    build: () => ({
      group: 'audio',
      label: 'Dolby Atmos',
      effect: 'Son positionné dans l’espace, y compris en hauteur : l’ambiance paraît plus enveloppante.',
    }),
  },
  {
    family: 'autonomie',
    match: /\b(\d{1,2})\s*(?:h|heures)\s*(?:d[’']autonomie|de lecture|d[’'][ée]coute)/,
    metric: (m) => Number(m[1]),
    unit: 'h',
    build: (m) => ({
      group: 'audio',
      label: `Autonomie ${m[1]} h`,
      effect: 'Durée annoncée par le fabricant, généralement mesurée à volume moyen sans réduction de bruit.',
    }),
  },

  // ---------------------------------------------------------- connectivité
  {
    family: 'sync',
    match: /\bg[- ]?sync\b/,
    build: () => ({
      group: 'connectivite',
      label: 'G-Sync',
      effect:
        'L’écran se synchronise sur la carte graphique NVIDIA : plus de déchirure d’image quand le nombre d’images par seconde varie.',
    }),
  },
  {
    family: 'sync',
    match: /\bfreesync\b/,
    build: () => ({
      group: 'connectivite',
      label: 'FreeSync',
      effect:
        'Même principe que G-Sync, du côté AMD : l’image reste cohérente même quand la cadence fluctue.',
    }),
  },
  {
    family: 'wifi',
    match: /\bwi-?fi\s?(6e|6|7)\b/,
    rank: (m) => (m[1] === '7' ? 3 : m[1] === '6e' ? 2 : 1),
    scale: 3,
    build: (m) => ({
      group: 'connectivite',
      label: `Wi-Fi ${m[1]}`,
      effect: 'Norme récente : débit plus élevé et meilleure tenue quand de nombreux appareils sont connectés.',
    }),
  },
  {
    family: 'bluetooth',
    match: /\bbluetooth\s?(\d[.\d]*)?/,
    // Sans numero de version annonce, on ne classe PAS : ne rien savoir
    // n'est pas la meme chose qu'etre en bas de gamme.
    rank: (m) => {
      const v = m[1] ? parseFloat(m[1]) : NaN;
      if (!Number.isFinite(v)) return undefined;
      return v >= 5.3 ? 3 : v >= 5 ? 2 : 1;
    },
    scale: 3,
    build: (m) => ({
      group: 'connectivite',
      label: m[1] ? `Bluetooth ${m[1]}` : 'Bluetooth',
      effect: 'Connexion sans fil courte portée, sans câble ni récepteur à brancher.',
    }),
  },
  {
    family: 'hdmi',
    match: /\bhdmi\s?2\.1\b/,
    rank: 2,
    scale: 2,
    build: () => ({
      group: 'connectivite',
      label: 'HDMI 2.1',
      effect:
        'Bande passante suffisante pour du 4K à 120 Hz : nécessaire pour exploiter une console récente à plein régime.',
    }),
  },

  // ------------------------------------------------------------------ usage
  {
    family: 'energie',
    match: /energy ?star/,
    build: () => ({
      group: 'usage',
      label: 'Energy Star',
      effect: 'Certifié pour une consommation inférieure à la moyenne de sa catégorie.',
    }),
  },
  {
    family: 'capacite',
    match: /\b(\d{1,2}[,.]?\d?)\s*(?:l|litres?)\b/,
    metric: (m) => Number(m[1].replace(',', '.')),
    unit: 'L',
    build: (m) => ({
      group: 'usage',
      label: `Capacité ${m[1]} L`,
      effect: 'Volume utile. À rapporter au nombre de personnes à servir plutôt qu’à l’encombrement.',
    }),
  },
  {
    family: 'capacite',
    // Pas de \b final : « ³ » n'est pas un caractere de mot, donc la frontiere
    // exigerait une lettre juste apres — or il y a une espace. La regle ne
    // pouvait matcher AUCUN produit, et toutes les capacites en pieds cubes
    // etaient perdues sans la moindre erreur.
    match: /\b(\d{1,2}[,.]?\d?)\s*pi[³3](?![a-z0-9])/,
    metric: (m) => Number(m[1].replace(',', '.')),
    unit: 'pi3',
    build: (m) => ({
      group: 'usage',
      label: `Capacité ${m[1]} pi³`,
      effect: 'Volume intérieur. Un réfrigérateur de 18 pi³ convient en général à un foyer de trois à quatre personnes.',
    }),
  },

  // ------------------------------------------------ materiaux et fabrication
  //
  // Le materiau est souvent la SEULE difference reelle entre deux articles de
  // cuisine ou de table au meme prix. Une assiette en porcelaine et une en
  // melamine ne vieillissent pas du tout pareil, et rien dans le titre ne le
  // signale a qui ne connait pas les termes.
  {
    family: 'materiau',
    onlyIn: CATEGORIES_MATIERE,
    match: /fonte [ée]maill[ée]e?|\bfonte\b/,
    rank: 4,
    scale: 4,
    build: () => ({
      group: 'usage',
      label: 'Fonte',
      effect:
        'Tres lourde, elle emmagasine la chaleur et la restitue longtemps : saisie reguliere et cuisson lente. Se garde des decennies.',
    }),
  },
  {
    family: 'materiau',
    onlyIn: CATEGORIES_MATIERE,
    match: /acier inoxydable|\binox\b/,
    rank: 4,
    scale: 4,
    build: () => ({
      group: 'usage',
      label: 'Acier inoxydable',
      effect:
        'Ne rouille pas, ne retient pas les odeurs et supporte le lave-vaisselle. Plus durable que l’aluminium ou le plastique, et plus lourd.',
    }),
  },
  {
    family: 'materiau',
    onlyIn: CATEGORIES_MATIERE,
    match: /porcelaine|c[ée]ramique|\bgr[èe]s\b|verre tremp[ée]/,
    rank: 3,
    scale: 4,
    build: () => ({
      group: 'usage',
      label: 'Porcelaine, ceramique ou verre trempe',
      effect:
        'Surface non poreuse : ne se tache pas et ne garde pas le gout. Resiste au lave-vaisselle, mais casse en cas de choc.',
    }),
  },
  {
    family: 'materiau',
    onlyIn: CATEGORIES_MATIERE,
    match: /\bbambou\b|bois massif|\bacacia\b|\bch[êe]ne\b|\bnoyer\b/,
    rank: 2,
    scale: 4,
    build: () => ({
      group: 'usage',
      label: 'Bois ou bambou',
      effect:
        'Agreable et solide, mais poreux : lavage a la main et huilage occasionnel, sinon il se fend.',
    }),
  },
  {
    family: 'materiau',
    onlyIn: CATEGORIES_MATIERE,
    match: /\baluminium\b/,
    rank: 2,
    scale: 4,
    build: () => ({
      group: 'usage',
      label: 'Aluminium',
      effect:
        'Leger et chauffe vite, mais se deforme et se raye plus facilement que l’acier. Souvent revetu pour compenser.',
    }),
  },
  {
    family: 'materiau',
    onlyIn: CATEGORIES_MATIERE,
    match: /m[ée]lamine|polypropyl[èe]ne|\bplastique\b|\bacrylique\b/,
    rank: 1,
    scale: 4,
    build: () => ({
      group: 'usage',
      label: 'Plastique ou melamine',
      effect:
        'Leger, incassable et bon marche. Se raye vite, se decolore, et supporte mal la chaleur comme le passage repete au lave-vaisselle.',
    }),
  },
  {
    family: 'revetement',
    onlyIn: CATEGORIES_MATIERE,
    match: /antiadh[ée]si(?:f|ve)|\bteflon\b/,
    build: () => ({
      group: 'usage',
      label: 'Revetement antiadhesif',
      effect:
        'Permet de cuire avec peu de gras et de nettoyer facilement. Le revetement s’use : il craint les ustensiles metalliques.',
    }),
  },

  // -------------------------------------------- electromenagers et entretien
  {
    family: 'puissance',
    match: /\b(\d{3,4})\s*(?:w|watts?)\b/,
    metric: (m) => Number(m[1]),
    unit: 'W',
    build: (m) => ({
      group: 'performance',
      label: `Puissance ${m[1]} W`,
      effect:
        'Determine la vitesse de chauffe ou la force du moteur. Une puissance elevee travaille plus vite, pas forcement mieux.',
    }),
  },
  {
    family: 'aspiration',
    match: /\b(\d{4,5})\s*pa\b/,
    metric: (m) => Number(m[1]),
    unit: 'Pa',
    build: (m) => ({
      group: 'performance',
      label: `Aspiration ${m[1]} Pa`,
      effect:
        'Force de succion. C’est ce qui separe un appareil capable de sortir la poussiere d’un tapis d’un autre qui ne fait que la surface.',
    }),
  },
  {
    family: 'bruit',
    match: /\b(\d{2})\s*dba\b|(?:niveau sonore|silencieux|bruit)[^.]{0,25}?(\d{2})\s*db\b/,
    metric: (m) => Number(m[1] ?? m[2]),
    unit: 'dB',
    // Moins de bruit est mieux : l'echelle s'inverse.
    lowerIsBetter: true,
    build: (m) => ({
      group: 'usage',
      label: `Niveau sonore ${m[1] ?? m[2]} dB`,
      effect:
        'Chaque tranche de 10 dB double le bruit percu. Sous 45 dB, un appareil peut tourner dans une piece ouverte sans gener.',
    }),
  },
  {
    family: 'debit-air',
    match: /\b(\d{3,4})\s*(?:pcm|cfm)\b/,
    metric: (m) => Number(m[1]),
    unit: 'PCM',
    build: (m) => ({
      group: 'performance',
      label: `Debit d’air ${m[1]} PCM`,
      effect:
        'Volume d’air evacue par minute. C’est ce qui decide si les odeurs et la vapeur partent vraiment.',
    }),
  },
  {
    family: 'btu',
    match: /\b(\d{1,3}[ ,]\d{3}|\d{4,6})\s*btu\b/,
    metric: (m) => Number(m[1].replace(/[ ,]/g, '')),
    unit: 'BTU',
    build: (m) => ({
      group: 'performance',
      label: `${m[1]} BTU`,
      effect:
        'Puissance de chauffe ou de refroidissement. Se choisit selon la surface a traiter : trop peu ne suffit pas, trop cycle sans deshumidifier.',
    }),
  },
  {
    family: 'essorage',
    match: /\b(\d{3,4})\s*(?:tr\/min|rpm)\b/,
    metric: (m) => Number(m[1]),
    unit: 'tr/min',
    build: (m) => ({
      group: 'performance',
      label: `Essorage ${m[1]} tr/min`,
      effect:
        'Plus la vitesse est elevee, moins le linge sort humide, et moins la secheuse travaille ensuite.',
    }),
  },
  {
    family: 'filtration',
    match: /\bhepa\b/,
    build: () => ({
      group: 'usage',
      label: 'Filtre HEPA',
      effect:
        'Retient les particules fines, pollens et acariens au lieu de les rejeter dans la piece. Utile en cas d’allergies.',
    }),
  },
  {
    family: 'navigation',
    match: /\blidar\b|cartographie (?:laser|intelligente)/,
    build: () => ({
      group: 'usage',
      label: 'Cartographie laser',
      effect:
        'L’appareil construit un plan du logement et nettoie en bandes ordonnees, au lieu de rebondir au hasard. Difference majeure de couverture et de duree.',
    }),
  },
  {
    family: 'vidange',
    match: /vidange automatique|auto[- ]?vidage|station de vidange/,
    build: () => ({
      group: 'usage',
      label: 'Station de vidange automatique',
      effect:
        'Le bac se vide seul dans la base : quelques semaines d’autonomie au lieu d’un geste apres chaque passage.',
    }),
  },
  {
    family: 'couverts',
    match: /\b(\d{1,2})\s*(?:couverts|places)\b/,
    metric: (m) => Number(m[1]),
    unit: 'couverts',
    build: (m) => ({
      group: 'usage',
      label: `${m[1]} couverts`,
      effect:
        'Nombre de services complets par cycle. Un foyer de quatre personnes remplit environ 12 couverts.',
    }),
  },
  {
    family: 'etancheite',
    match: /\bipx?(\d)\b/,
    rank: (m) => {
      const d = Number(m[1]);
      return d >= 8 ? 4 : d >= 7 ? 3 : d >= 5 ? 2 : 1;
    },
    scale: 4,
    build: (m) => ({
      group: 'usage',
      label: `Indice d’etancheite IP${m[1]}`,
      effect:
        Number(m[1]) >= 7
          ? 'Resiste a l’immersion : la pluie, la sueur ou une chute dans l’evier ne posent pas de probleme.'
          : 'Resiste aux projections d’eau, pas a l’immersion.',
    }),
  },
  {
    family: 'garantie',
    match: /garantie (?:limit[ée]e )?(?:de )?(\d{1,2})\s*ans?/,
    metric: (m) => Number(m[1]),
    unit: 'ans',
    build: (m) => ({
      group: 'usage',
      label: `Garantie ${m[1]} an${Number(m[1]) > 1 ? 's' : ''}`,
      effect:
        'Ce que le fabricant accepte de couvrir. Une garantie longue est aussi un signal sur la duree de vie attendue.',
    }),
  },

  // --------------------------------------------- fonctions d'electromenager
  //
  // Un refrigerateur se choisit autant sur ses fonctions que sur son volume :
  // distributeur, configuration des portes, degivrage. Rien de tout cela
  // n'apparaissait, alors que les titres le disent explicitement.
  {
    family: 'distributeur',
    onlyIn: CATEGORIES_ELECTRO,
    match: /distributeur d[’']eau et de (?:glace|gla[çc]ons)|distributeur de gla[çc]ons et d[’']eau/,
    rank: 2,
    scale: 2,
    build: () => ({
      group: 'usage',
      label: 'Distributeur d’eau et de glaçons',
      effect:
        'Eau filtree et glacons sans ouvrir la porte. Demande un raccordement a l’eau, et occupe de l’espace dans la porte.',
    }),
  },
  {
    family: 'distributeur',
    onlyIn: CATEGORIES_ELECTRO,
    match: /distributeur d[’']eau/,
    rank: 1,
    scale: 2,
    build: () => ({
      group: 'usage',
      label: 'Distributeur d’eau',
      effect:
        'Eau fraiche sans ouvrir la porte. Demande un raccordement a l’eau ; certains modeles utilisent un reservoir a remplir.',
    }),
  },
  {
    family: 'glacons',
    onlyIn: CATEGORIES_ELECTRO,
    match: /machine [àa] gla[çc]ons|fabrique de gla[çc]ons|fabrique-gla[çc]ons|distributeur de gla[çc]ons/,
    build: () => ({
      group: 'usage',
      label: 'Fabrique de glaçons',
      effect: 'Produit et stocke les glacons en continu : plus de bacs a remplir ni a attendre.',
    }),
  },
  {
    family: 'configuration',
    onlyIn: CATEGORIES_ELECTRO,
    match: /portes? fran[çc]aises?|french door|[àa] deux portes/,
    build: () => ({
      group: 'usage',
      label: 'Portes françaises',
      effect:
        'Deux portes etroites en haut, congelateur en tiroir en bas. Les aliments frais restent a hauteur des yeux et les portes debordent moins dans la piece.',
    }),
  },
  {
    family: 'configuration',
    onlyIn: CATEGORIES_ELECTRO,
    match: /juxtapos[ée]|c[ôo]te [àa] c[ôo]te|side[- ]by[- ]side/,
    build: () => ({
      group: 'usage',
      label: 'Congélateur juxtaposé',
      effect:
        'Refrigerateur et congelateur cote a cote, sur toute la hauteur. Pratique pour les surgeles, mais chaque compartiment est etroit.',
    }),
  },
  {
    family: 'configuration',
    onlyIn: CATEGORIES_ELECTRO,
    match: /cong[ée]lateur (?:en bas|inf[ée]rieur)/,
    build: () => ({
      group: 'usage',
      label: 'Congélateur en bas',
      effect:
        'Le compartiment le plus utilise est en haut, a hauteur d’homme. Configuration la plus courante et la plus economique.',
    }),
  },
  {
    family: 'givre',
    onlyIn: CATEGORIES_ELECTRO,
    match: /sans (?:givre|d[ée]givrage)|no[- ]frost|d[ée]givrage automatique/,
    build: () => ({
      group: 'usage',
      label: 'Sans givre',
      effect: 'Plus de degivrage manuel : l’appareil evacue l’humidite tout seul.',
    }),
  },
  {
    family: 'cuisson',
    onlyIn: CATEGORIES_ELECTRO,
    match: /friture [àa] air|air fry|\bairfryer\b/,
    build: () => ({
      group: 'usage',
      label: 'Cuisson à air chaud',
      effect:
        'Un ventilateur fait circuler l’air tres chaud : texture proche de la friture avec une fraction du gras.',
    }),
  },
  {
    family: 'convection',
    onlyIn: CATEGORIES_ELECTRO,
    match: /\bconvection\b/,
    build: () => ({
      group: 'usage',
      label: 'Cuisson par convection',
      effect:
        'L’air chaud circule : cuisson plus rapide et plus uniforme, et plusieurs plaques a la fois sans intervertir.',
    }),
  },
  {
    family: 'autonettoyant',
    onlyIn: CATEGORIES_ELECTRO,
    match: /autonettoyant|auto[- ]nettoyage|\bpyrolyse\b/,
    build: () => ({
      group: 'usage',
      label: 'Autonettoyant',
      effect: 'Le four brule les residus a tres haute temperature ; il ne reste que de la cendre a essuyer.',
    }),
  },
  {
    family: 'plaque',
    onlyIn: CATEGORIES_ELECTRO,
    match: /\binduction\b/,
    rank: 3,
    scale: 3,
    build: () => ({
      group: 'usage',
      label: 'Plaque à induction',
      effect:
        'Chauffe la casserole directement : le plus rapide et le plus precis, la surface reste froide. Exige des ustensiles magnetiques.',
    }),
  },
  {
    family: 'plaque',
    onlyIn: CATEGORIES_ELECTRO,
    match: /au gaz\b|\bgaz naturel\b|\bpropane\b/,
    rank: 2,
    scale: 3,
    build: () => ({
      group: 'usage',
      label: 'Cuisson au gaz',
      effect: 'Reglage instantane et visible de la flamme. Demande un raccordement au gaz.',
    }),
  },
  {
    family: 'plaque',
    onlyIn: CATEGORIES_ELECTRO,
    match: /vitroc[ée]ramique|[ée]l[ée]ments? radiants?/,
    rank: 1,
    scale: 3,
    build: () => ({
      group: 'usage',
      label: 'Plaque vitrocéramique',
      effect: 'Surface lisse, facile a nettoyer. Monte et descend en temperature plus lentement qu’une induction.',
    }),
  },
  {
    family: 'chargement',
    onlyIn: CATEGORIES_ELECTRO,
    match: /chargement frontal|[àa] hublot/,
    build: () => ({
      group: 'usage',
      label: 'Chargement frontal',
      effect:
        'Consomme moins d’eau et essore plus fort qu’une laveuse a chargement vertical. Se superpose avec la secheuse.',
    }),
  },
  {
    family: 'chargement',
    onlyIn: CATEGORIES_ELECTRO,
    match: /chargement vertical|chargement par le haut/,
    build: () => ({
      group: 'usage',
      label: 'Chargement vertical',
      effect:
        'Cycles plus courts et chargement sans se baisser ; en general moins econome en eau qu’un chargement frontal.',
    }),
  },
  {
    family: 'connecte',
    match: /\bwi-?fi int[ée]gr[ée]|application mobile|command[ée]e? par (?:application|t[ée]l[ée]phone)|compatible (?:alexa|google assistant)/,
    build: () => ({
      group: 'connectivite',
      label: 'Pilotable à distance',
      effect:
        'Se commande depuis un telephone, et previent en fin de cycle. Utile au quotidien, dependant d’un service en ligne qui peut fermer.',
    }),
  },

  // --------------------------------------------------------- jeux et jouets
  {
    family: 'joueurs',
    onlyIn: CATEGORIES_JEUX,
    match: /(\d)\s*(?:[àa-]|\u2013)\s*(\d{1,2})\s*joueurs/,
    metric: (m) => Number(m[2]),
    unit: 'joueurs',
    build: (m) => ({
      group: 'usage',
      label: `${m[1]} à ${m[2]} joueurs`,
      effect:
        'Le premier chiffre compte autant que le deuxieme : beaucoup de jeux tombent a plat a deux, meme s’ils l’autorisent.',
    }),
  },
  {
    family: 'age-min',
    onlyIn: CATEGORIES_JEUX,
    match: /[âa]g[ée]s? de (\d{1,2}) ans|(\d{1,2}) ans et plus|\b(\d{1,2})\+\s*ans/,
    metric: (m) => Number(m[1] ?? m[2] ?? m[3]),
    unit: 'ans',
    build: (m) => ({
      group: 'usage',
      label: `Dès ${m[1] ?? m[2] ?? m[3]} ans`,
      effect:
        'Age recommande par l’editeur. Il tient compte des petites pieces autant que de la difficulte des regles.',
    }),
  },
  {
    family: 'duree-partie',
    onlyIn: CATEGORIES_JEUX,
    match: /(\d{2,3})\s*(?:min|minutes)\b/,
    metric: (m) => Number(m[1]),
    unit: 'min',
    build: (m) => ({
      group: 'usage',
      label: `Partie de ${m[1]} min`,
      effect: 'Duree annoncee d’une partie. Determine si le jeu sort un soir de semaine ou seulement le week-end.',
    }),
  },

  // ------------------------------------------------------ soins et contenance
  {
    family: 'contenance',
    onlyIn: CATEGORIES_BEAUTE,
    match: /\b(\d{2,4})\s*ml\b/,
    metric: (m) => Number(m[1]),
    unit: 'ml',
    build: (m) => ({
      group: 'usage',
      label: `Contenance ${m[1]} ml`,
      effect: 'A rapporter au prix : le format le plus gros n’est pas toujours le moins cher au millilitre.',
    }),
  },
  {
    family: 'contenance',
    onlyIn: CATEGORIES_BEAUTE,
    match: /\b(\d{1,2}[,.]\d)\s*oz\b/,
    metric: (m) => Number(m[1].replace(',', '.')) * 29.57,
    unit: 'ml',
    build: (m) => ({
      group: 'usage',
      label: `Contenance ${m[1]} oz`,
      effect: 'A rapporter au prix : le format le plus gros n’est pas toujours le moins cher a la dose.',
    }),
  },

  // ------------------------------------------------------------------ encre
  {
    family: 'encre-origine',
    match: /cartouche.{0,30}(?:d[’']origine|originale?|authentique|\bOEM\b)/i,
    rank: 2,
    scale: 2,
    build: () => ({
      group: 'usage',
      label: 'Cartouche d’origine',
      effect:
        'Fabriquee par le constructeur de l’imprimante : rendement annonce fiable et aucun risque de blocage logiciel.',
    }),
  },
  {
    family: 'encre-origine',
    match: /\bcompatible\b.{0,40}(?:imprimante|epson|canon|hp|brother|lexmark)|\bremanufactur/,
    rank: 1,
    scale: 2,
    build: () => ({
      group: 'usage',
      label: 'Cartouche compatible',
      effect:
        'Fabriquee par un tiers : bien moins chere, mais rendement variable et certaines imprimantes la refusent apres mise a jour.',
    }),
  },
  {
    family: 'rendement',
    match: /(\d{3,5})\s*pages/,
    metric: (m) => Number(m[1]),
    unit: 'pages',
    build: (m) => ({
      group: 'usage',
      label: `Rendement ${m[1]} pages`,
      effect:
        'Nombre de pages annonce, mesure a 5 % de couverture. C’est le seul chiffre qui permette de comparer un prix a l’usage.',
    }),
  },

  // ----------------------------------------------------------------- outils
  {
    family: 'moteur',
    onlyIn: CATEGORIES_OUTILS,
    match: /sans balais|\bbrushless\b/,
    rank: 2,
    scale: 2,
    build: () => ({
      group: 'performance',
      label: 'Moteur sans balais',
      effect:
        'Pas de pieces d’usure frottantes : plus de couple, moins de chaleur, et une autonomie sensiblement meilleure sur batterie.',
    }),
  },
  {
    family: 'tension',
    onlyIn: CATEGORIES_OUTILS,
    match: /\b(\d{2})\s*v\b(?!\w)/,
    metric: (m) => Number(m[1]),
    unit: 'V',
    build: (m) => ({
      group: 'performance',
      label: `Batterie ${m[1]} V`,
      effect:
        'La tension donne la puissance disponible. Elle engage aussi : les batteries d’une gamme ne vont que sur les outils de la meme gamme.',
    }),
  },
];

export const normalizeSpecText = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const normalize = normalizeSpecText;

/**
 * Extrait les caractéristiques d'un produit depuis son titre et sa description.
 *
 * L'ordre des règles compte : les plus spécifiques d'abord (QD-OLED avant
 * OLED, 4K avant 1080p), et une seule règle par famille est retenue — annoncer
 * à la fois « 4K » et « 1080p » pour un même écran n'aurait aucun sens.
 */
export function extractSpecs(
  title: string,
  description?: string | null,
  categorySlug?: string | null,
): Spec[] {
  const texte = normalize(`${title} ${description ?? ''}`);
  const specs: Spec[] = [];
  const vus = new Set<string>();

  for (const rule of RULES) {
    // Une regle restreinte reste silencieuse hors de son domaine — y compris
    // quand la categorie est inconnue : mieux vaut ne rien dire que risquer un
    // verdict hors sujet.
    if (rule.onlyIn && !(categorySlug && rule.onlyIn.has(categorySlug))) continue;

    const m = texte.match(rule.match);
    if (!m) continue;

    // Une seule caractéristique par famille : la première règle qui matche
    // gagne, et les règles sont ordonnées du plus précis au plus général.
    if (vus.has(rule.family)) continue;
    vus.add(rule.family);

    const rang = typeof rule.rank === 'function' ? rule.rank(m) : rule.rank;
    const valeur = rule.metric?.(m);
    specs.push({
      ...rule.build(m),
      family: rule.family,
      ...(rang !== undefined ? { rank: rang, scale: rule.scale } : {}),
      ...(valeur !== undefined && Number.isFinite(valeur)
        ? { metric: valeur, unit: rule.unit, lowerIsBetter: rule.lowerIsBetter }
        : {}),
    });
  }

  return specs;
}

/**
 * Nom lisible de chaque famille, et ORDRE d'affichage dans les filtres.
 *
 * L'ordre n'est pas alphabetique : il suit ce qui decide un achat. Personne ne
 * choisit un ordinateur par son indice d'etancheite, mais beaucoup le
 * choisissent par son processeur. Les criteres decisifs passent devant.
 */
export const FAMILY_LABEL: Record<string, string> = {
  'cpu-marque': 'Marque du processeur',
  cpu: 'Gamme du processeur',
  ram: 'Mémoire vive',
  'stockage-taille': 'Stockage',
  'stockage-type': 'Type de stockage',
  'gpu-marque': 'Type de graphiques',
  gpu: 'Carte graphique',

  resolution: 'Résolution',
  dalle: 'Type de dalle',
  rafraichissement: 'Rafraîchissement',
  diagonale: 'Taille de l’écran',
  reponse: 'Temps de réponse',
  hdr: 'HDR',
  courbure: 'Courbure',

  capacite: 'Capacité',
  puissance: 'Puissance',
  aspiration: 'Aspiration',
  bruit: 'Niveau sonore',
  'debit-air': 'Débit d’air',
  btu: 'BTU',
  essorage: 'Essorage',
  couverts: 'Couverts',
  materiau: 'Matériau',
  revetement: 'Revêtement',
  filtration: 'Filtration',
  navigation: 'Navigation',
  vidange: 'Vidange',
  energie: 'Consommation',
  garantie: 'Garantie',
  etancheite: 'Étanchéité',
  autonomie: 'Autonomie',

  distributeur: 'Distributeur',
  glacons: 'Glaçons',
  configuration: 'Configuration',
  givre: 'Dégivrage',
  cuisson: 'Cuisson à air',
  convection: 'Convection',
  autonettoyant: 'Autonettoyant',
  plaque: 'Type de cuisson',
  chargement: 'Chargement',
  connecte: 'Pilotable à distance',
  joueurs: 'Nombre de joueurs',
  'age-min': 'Âge minimum',
  'duree-partie': 'Durée de partie',
  contenance: 'Contenance',
  'encre-origine': 'Origine de la cartouche',
  rendement: 'Rendement',
  moteur: 'Type de moteur',
  tension: 'Tension de batterie',

  'reduction-bruit': 'Réduction de bruit',
  'audio-spatial': 'Son spatial',
  wifi: 'Wi-Fi',
  bluetooth: 'Bluetooth',
  hdmi: 'HDMI',
  sync: 'Synchronisation',
};

export const FAMILY_ORDER: readonly string[] = [
  'cpu-marque', 'cpu', 'ram', 'stockage-taille', 'stockage-type',
  'gpu-marque', 'gpu',
  'resolution', 'dalle', 'diagonale', 'rafraichissement', 'reponse', 'hdr', 'courbure',
  'capacite', 'configuration', 'distributeur', 'glacons', 'givre', 'plaque',
  'cuisson', 'convection', 'autonettoyant', 'chargement', 'connecte',
  'puissance', 'aspiration', 'bruit', 'debit-air', 'btu', 'essorage', 'moteur',
  'tension', 'joueurs', 'age-min', 'duree-partie', 'contenance',
  'encre-origine', 'rendement',
  'couverts', 'materiau', 'revetement', 'filtration', 'navigation', 'vidange',
  'autonomie', 'garantie', 'energie', 'etancheite',
  'reduction-bruit', 'audio-spatial', 'wifi', 'bluetooth', 'hdmi', 'sync',
];

export const SPEC_GROUP_LABEL: Record<Spec['group'], string> = {
  image: 'Image',
  performance: 'Performance',
  audio: 'Audio',
  connectivite: 'Connectivité',
  usage: 'Usage',
};

/**
 * Première phrase du descriptif marchand, pour introduire la fiche.
 *
 * Un pavé de texte publicitaire n'aide personne à décider : on garde
 * l'accroche, et les caractéristiques expliquées font le reste du travail.
 */
export function leadSentence(description: string | null | undefined): string | null {
  if (!description) return null;
  const phrases = description.split(/(?<=[.!?])\s+/);
  const lead = phrases.slice(0, 2).join(' ').trim();
  return lead.length > 20 ? lead : description.slice(0, 220).trim();
}
