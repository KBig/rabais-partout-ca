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
}

interface SpecRule {
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
  build: (m: RegExpMatchArray) => Spec;
}

const RULES: SpecRule[] = [
  // ------------------------------------------------------------------ image
  {
    family: 'resolution',
    match: /\b(?:8k)\b/,
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
    match: /\b(\d{2,3})\s*(?:po|pouces?)\b/,
    build: (m) => ({
      group: 'image',
      label: `Diagonale ${m[1]} po`,
      effect: `Mesurée en diagonale, coin à coin. Compte autant que la résolution : plus l’écran est grand, plus il faut de pixels pour rester net.`,
    }),
  },

  // ------------------------------------------------------------ performance
  {
    family: 'gpu',
    match: /\b(?:rtx|gtx)\s?(\d{4})/,
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
    build: (m) => ({
      group: 'connectivite',
      label: `Wi-Fi ${m[1]}`,
      effect: 'Norme récente : débit plus élevé et meilleure tenue quand de nombreux appareils sont connectés.',
    }),
  },
  {
    family: 'bluetooth',
    match: /\bbluetooth\s?(\d[.\d]*)?/,
    build: (m) => ({
      group: 'connectivite',
      label: m[1] ? `Bluetooth ${m[1]}` : 'Bluetooth',
      effect: 'Connexion sans fil courte portée, sans câble ni récepteur à brancher.',
    }),
  },
  {
    family: 'hdmi',
    match: /\bhdmi\s?2\.1\b/,
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
    build: (m) => ({
      group: 'usage',
      label: `Capacité ${m[1]} L`,
      effect: 'Volume utile. À rapporter au nombre de personnes à servir plutôt qu’à l’encombrement.',
    }),
  },
  {
    family: 'capacite',
    match: /\b(\d{1,2}[,.]?\d?)\s*pi[³3]\b/,
    build: (m) => ({
      group: 'usage',
      label: `Capacité ${m[1]} pi³`,
      effect: 'Volume intérieur. Un réfrigérateur de 18 pi³ convient en général à un foyer de trois à quatre personnes.',
    }),
  },
];

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Extrait les caractéristiques d'un produit depuis son titre et sa description.
 *
 * L'ordre des règles compte : les plus spécifiques d'abord (QD-OLED avant
 * OLED, 4K avant 1080p), et une seule règle par famille est retenue — annoncer
 * à la fois « 4K » et « 1080p » pour un même écran n'aurait aucun sens.
 */
export function extractSpecs(title: string, description?: string | null): Spec[] {
  const texte = normalize(`${title} ${description ?? ''}`);
  const specs: Spec[] = [];
  const vus = new Set<string>();

  for (const rule of RULES) {
    const m = texte.match(rule.match);
    if (!m) continue;

    // Une seule caractéristique par famille : la première règle qui matche
    // gagne, et les règles sont ordonnées du plus précis au plus général.
    if (vus.has(rule.family)) continue;
    vus.add(rule.family);
    specs.push(rule.build(m));
  }

  return specs;
}

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
