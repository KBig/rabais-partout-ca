import type { StoreMeta } from './types';

/**
 * Fabricants, toutes catégories confondues.
 *
 * ----------------------------------------------------------------------------
 * POURQUOI CETTE LISTE EST SI LONGE, ET POURQUOI C'EST PEU COÛTEUX
 * ----------------------------------------------------------------------------
 *
 * Le prix publié par un fabricant est l'ancre de référence la plus fiable qui
 * existe : c'est le prix fixé par celui qui fixe le prix. Mais une première
 * version de ce registre ne listait que des marques informatiques — alors que
 * le catalogue couvre la cuisine, les aspirateurs, le mobilier, la literie,
 * les jouets, les animaux, l'outillage. La référence manquait précisément là
 * où le catalogue est le plus gros.
 *
 * Déclarer une marque ne coûte rien : sans `adapter`, elle apparaît comme
 * « bientôt disponible » et n'est jamais interrogée. Ce qui coûte, c'est
 * l'adaptateur.
 *
 * ----------------------------------------------------------------------------
 * LA STRATÉGIE D'IMPLÉMENTATION QUI ÉVITE 30 SCRAPERS
 * ----------------------------------------------------------------------------
 *
 * Écrire un adaptateur par marque serait ingérable. La quasi-totalité des
 * sites marchands publient pourtant leurs prix en **JSON-LD schema.org**
 * (`<script type="application/ld+json">` contenant un `Product` avec ses
 * `offers`). C'est un format NORMALISÉ, identique d'un site à l'autre.
 *
 * Un seul extracteur générique couvre donc des dizaines de marques ; chaque
 * marque n'apporte plus qu'une information propre : comment atteindre la fiche
 * d'un produit à partir de son numéro de modèle. C'est ce que décrit
 * `productUrlPattern` ci-dessous — `{model}` y est remplacé par le modèle
 * normalisé.
 */

/** Une marque déclarée, en attente d'adaptateur. */
interface ManufacturerSeed {
  id: string;
  name: string;
  homepage: string;
  color: string;
  /** Catégories canoniques où cette marque pèse. Sert à prioriser le travail. */
  covers: string[];
  /**
   * Gabarit d'URL de recherche sur le site du fabricant. `{model}` est
   * substitué. Renseigné au fur et à mesure ; un gabarit absent signifie
   * simplement que personne n'a encore vérifié le site.
   */
  searchUrl?: string;
}

const SEEDS: ManufacturerSeed[] = [
  // --- Informatique, mobile, image et son ---------------------------------
  { id: 'apple', name: 'Apple', homepage: 'https://www.apple.com/ca/fr/', color: '#555555',
    covers: ['portables', 'ordinateurs', 'tablettes', 'telephones', 'montres', 'casques'] },
  { id: 'dell', name: 'Dell', homepage: 'https://www.dell.com/fr-ca', color: '#007DB8',
    covers: ['portables', 'ordinateurs', 'moniteurs'] },
  { id: 'lenovo', name: 'Lenovo', homepage: 'https://www.lenovo.com/ca/fr/', color: '#E2231A',
    covers: ['portables', 'ordinateurs', 'tablettes', 'moniteurs'] },
  { id: 'hp', name: 'HP', homepage: 'https://www.hp.com/ca-fr/', color: '#0096D6',
    covers: ['portables', 'ordinateurs', 'imprimantes', 'encre-toner', 'moniteurs'] },
  { id: 'asus', name: 'ASUS', homepage: 'https://www.asus.com/ca-fr/', color: '#00539B',
    covers: ['portables', 'moniteurs', 'composants', 'reseau'] },
  { id: 'acer', name: 'Acer', homepage: 'https://www.acer.com/ca-fr/', color: '#83B81A',
    covers: ['portables', 'moniteurs', 'ordinateurs'] },
  { id: 'samsung', name: 'Samsung', homepage: 'https://www.samsung.com/ca_fr/', color: '#1428A0',
    covers: ['televiseurs', 'telephones', 'moniteurs', 'gros-electro', 'aspirateurs', 'montres'] },
  { id: 'lg', name: 'LG', homepage: 'https://www.lg.com/ca_fr', color: '#A50034',
    covers: ['televiseurs', 'moniteurs', 'gros-electro', 'aspirateurs'] },
  { id: 'sony', name: 'Sony', homepage: 'https://www.sony.ca/fr', color: '#000000',
    covers: ['televiseurs', 'casques', 'audio', 'cameras', 'playstation'] },
  { id: 'canon', name: 'Canon', homepage: 'https://www.canon.ca/fr', color: '#CC0000',
    covers: ['cameras', 'imprimantes', 'encre-toner'] },
  { id: 'tcl', name: 'TCL', homepage: 'https://www.tcl.com/ca-fr/', color: '#E60012',
    covers: ['televiseurs'] },

  // --- Audio ---------------------------------------------------------------
  { id: 'sonos', name: 'Sonos', homepage: 'https://www.sonos.com/fr-ca/', color: '#000000',
    covers: ['audio'] },
  { id: 'bose', name: 'Bose', homepage: 'https://www.bose.ca/fr_ca', color: '#000000',
    covers: ['casques', 'audio'] },
  { id: 'jbl', name: 'JBL', homepage: 'https://ca.jbl.com/', color: '#FF6600',
    covers: ['casques', 'audio'] },

  // --- Cuisine et petits électroménagers ----------------------------------
  { id: 'ninja', name: 'Ninja', homepage: 'https://www.ninjakitchen.ca/', color: '#003057',
    covers: ['petits-electro', 'cuisine'] },
  { id: 'instant', name: 'Instant', homepage: 'https://www.instanthome.com/ca-fr', color: '#E4002B',
    covers: ['petits-electro', 'cuisine'] },
  { id: 'cuisinart', name: 'Cuisinart', homepage: 'https://www.cuisinart.ca/', color: '#8B0000',
    covers: ['petits-electro', 'cuisine'] },
  { id: 'kitchenaid', name: 'KitchenAid', homepage: 'https://www.kitchenaid.ca/fr_CA/', color: '#C41230',
    covers: ['petits-electro', 'gros-electro', 'cuisine'] },
  { id: 'breville', name: 'Breville', homepage: 'https://www.breville.com/ca/fr/', color: '#000000',
    covers: ['petits-electro', 'cuisine'] },
  { id: 'delonghi', name: "De'Longhi", homepage: 'https://www.delonghi.com/fr-ca/', color: '#003A70',
    covers: ['petits-electro', 'cuisine'] },
  { id: 'keurig', name: 'Keurig', homepage: 'https://www.keurig.ca/fr', color: '#B01B2E',
    covers: ['petits-electro'] },
  { id: 'philips', name: 'Philips', homepage: 'https://www.philips.ca/fr', color: '#0B5ED7',
    covers: ['petits-electro', 'beaute-sante', 'soins-dentaires', 'soins-cheveux'] },

  // --- Aspirateurs et entretien --------------------------------------------
  { id: 'dyson', name: 'Dyson', homepage: 'https://www.dysoncanada.ca/fr', color: '#4B0082',
    covers: ['aspirateurs', 'soins-cheveux'] },
  { id: 'shark', name: 'Shark', homepage: 'https://www.sharkclean.ca/', color: '#00AEEF',
    covers: ['aspirateurs'] },
  { id: 'bissell', name: 'Bissell', homepage: 'https://www.bissell.ca/fr', color: '#E31837',
    covers: ['aspirateurs'] },
  { id: 'irobot', name: 'iRobot', homepage: 'https://www.irobot.ca/fr_CA/', color: '#00A94F',
    covers: ['aspirateurs'] },

  // --- Gros électroménagers -------------------------------------------------
  { id: 'whirlpool', name: 'Whirlpool', homepage: 'https://www.whirlpool.ca/fr_ca/', color: '#F5A800',
    covers: ['gros-electro'] },
  { id: 'frigidaire', name: 'Frigidaire', homepage: 'https://www.frigidaire.ca/fr/', color: '#C8102E',
    covers: ['gros-electro'] },
  { id: 'bosch', name: 'Bosch', homepage: 'https://www.bosch-home.ca/fr', color: '#EA0016',
    covers: ['gros-electro', 'outils-electriques'] },

  // --- Outillage ------------------------------------------------------------
  { id: 'dewalt', name: 'DeWalt', homepage: 'https://www.dewalt.ca/fr', color: '#FEBD17',
    covers: ['outils', 'outils-electriques'] },
  { id: 'milwaukee', name: 'Milwaukee', homepage: 'https://www.milwaukeetool.ca/fr', color: '#DB021D',
    covers: ['outils', 'outils-electriques'] },
  { id: 'makita', name: 'Makita', homepage: 'https://www.makita.ca/fr/', color: '#008B8B',
    covers: ['outils', 'outils-electriques'] },

  // --- Sport, santé, bébé, mobilier ----------------------------------------
  { id: 'garmin', name: 'Garmin', homepage: 'https://www.garmin.com/fr-CA/', color: '#007CC3',
    covers: ['montres', 'fitness', 'gps'] },
  { id: 'graco', name: 'Graco', homepage: 'https://www.gracobaby.ca/fr/', color: '#005EB8',
    covers: ['poussettes', 'bebe'] },
  { id: 'sterilite', name: 'Sterilite', homepage: 'https://www.sterilite.com/', color: '#0072CE',
    covers: ['rangement'] },
  { id: 'lego', name: 'LEGO', homepage: 'https://www.lego.com/fr-ca', color: '#D01012',
    covers: ['lego', 'jouets'] },
];

/**
 * Convertit les déclarations en entrées de registre. Aucune n'a d'adaptateur :
 * elles sont visibles dans l'interface comme sources à venir, et jamais
 * interrogées tant qu'un adaptateur n'est pas branché.
 */
export const MANUFACTURERS: StoreMeta[] = SEEDS.map((m) => ({
  id: `${m.id}-ca`,
  name: m.name,
  kind: 'manufacturer' as const,
  country: 'CA',
  currency: 'CAD',
  homepage: m.homepage,
  color: m.color,
  requestsPerSecond: 0.5,
}));

/** Catégories couvertes par au moins une marque déclarée. */
export const MANUFACTURER_COVERAGE = new Map<string, string[]>(
  (() => {
    const byCategory = new Map<string, string[]>();
    for (const m of SEEDS) {
      for (const c of m.covers) {
        byCategory.set(c, [...(byCategory.get(c) ?? []), m.name]);
      }
    }
    return [...byCategory.entries()];
  })(),
);
