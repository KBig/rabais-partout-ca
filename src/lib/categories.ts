/**
 * Taxonomie canonique, volontairement indépendante des magasins.
 *
 * Chaque adaptateur traduit ses propres rayons vers ces slugs. C'est ce qui
 * permet de faire cohabiter un téléviseur Best Buy, un téléviseur Costco et un
 * téléviseur Walmart dans une seule page comparable.
 */

export interface CategoryDef {
  slug: string;
  name: string;
  parent?: string;
  icon?: string;
}

export const CATEGORIES: CategoryDef[] = [
  { slug: 'electronique',       name: 'Électronique',           icon: '📺' },
  { slug: 'televiseurs',        name: 'Téléviseurs',            parent: 'electronique' },
  { slug: 'audio',              name: 'Audio & Son',            parent: 'electronique' },
  { slug: 'casques',            name: 'Casques & Écouteurs',    parent: 'electronique' },
  { slug: 'cameras',            name: 'Photo & Vidéo',          parent: 'electronique' },
  { slug: 'maison-intelligente',name: 'Maison intelligente',    parent: 'electronique' },

  { slug: 'informatique',       name: 'Informatique',           icon: '💻' },
  { slug: 'portables',          name: 'Portables',              parent: 'informatique' },
  { slug: 'ordinateurs',        name: 'Ordinateurs de bureau',  parent: 'informatique' },
  { slug: 'moniteurs',          name: 'Moniteurs',              parent: 'informatique' },
  { slug: 'composants',         name: 'Composants PC',          parent: 'informatique' },
  { slug: 'stockage',           name: 'Stockage & Disques',     parent: 'informatique' },
  { slug: 'imprimantes',        name: 'Imprimantes',            parent: 'informatique' },
  { slug: 'reseau',             name: 'Réseau & Wi-Fi',         parent: 'informatique' },

  { slug: 'mobile',             name: 'Mobile & Tablettes',     icon: '📱' },
  { slug: 'telephones',         name: 'Téléphones déverrouillés', parent: 'mobile' },
  { slug: 'telephones-forfait',  name: 'Téléphones avec forfait',  parent: 'mobile' },
  { slug: 'tablettes',          name: 'Tablettes',              parent: 'mobile' },
  { slug: 'montres',            name: 'Montres connectées',     parent: 'mobile' },
  { slug: 'accessoires-mobile', name: 'Accessoires mobiles',    parent: 'mobile' },

  { slug: 'jeux-video',         name: 'Jeux vidéo',             icon: '🎮' },
  { slug: 'playstation',        name: 'PlayStation',            parent: 'jeux-video' },
  { slug: 'nintendo',           name: 'Nintendo',               parent: 'jeux-video' },
  { slug: 'xbox',               name: 'Xbox',                   parent: 'jeux-video' },
  { slug: 'pc-gaming',          name: 'PC Gaming',              parent: 'jeux-video' },
  { slug: 'realite-virtuelle',  name: 'Réalité virtuelle',      parent: 'jeux-video' },

  { slug: 'electromenagers',    name: 'Électroménagers',        icon: '🧺' },
  { slug: 'gros-electro',       name: 'Gros électroménagers',   parent: 'electromenagers' },
  { slug: 'petits-electro',     name: 'Petits électroménagers', parent: 'electromenagers' },
  { slug: 'aspirateurs',        name: 'Aspirateurs',            parent: 'electromenagers' },

  { slug: 'maison',             name: 'Maison & Cuisine',       icon: '🏠' },
  { slug: 'cuisine',            name: 'Cuisine & Vaisselle',    parent: 'maison' },
  { slug: 'literie',            name: 'Literie & Textiles',     parent: 'maison' },
  { slug: 'rangement',          name: 'Rangement',              parent: 'maison' },
  { slug: 'luminaires',         name: 'Luminaires',             parent: 'maison' },
  { slug: 'decoration',         name: 'Décoration',             parent: 'maison' },

  { slug: 'meubles',            name: 'Meubles',                icon: '🛋️' },
  { slug: 'salon',              name: 'Salon',                  parent: 'meubles' },
  { slug: 'chambre',            name: 'Chambre',                parent: 'meubles' },
  { slug: 'salle-a-manger',     name: 'Salle à manger',         parent: 'meubles' },
  { slug: 'bureau-meubles',     name: 'Bureau',                 parent: 'meubles' },

  { slug: 'outils',             name: 'Outils & Rénovation',    icon: '🔧' },
  { slug: 'outils-electriques', name: 'Outils électriques',     parent: 'outils' },
  { slug: 'outils-main',        name: 'Outils à main',          parent: 'outils' },
  { slug: 'quincaillerie',      name: 'Quincaillerie',          parent: 'outils' },
  { slug: 'jardinage',          name: 'Jardinage & Extérieur',  parent: 'outils' },

  { slug: 'auto',               name: 'Auto',                   icon: '🚗' },
  { slug: 'pieces-auto',        name: 'Pièces & Entretien',     parent: 'auto' },
  { slug: 'audio-auto',         name: 'Audio & Vidéo auto',     parent: 'auto' },
  { slug: 'cameras-auto',       name: 'Caméras de route',       parent: 'auto' },
  { slug: 'accessoires-auto',   name: 'Gadgets & Accessoires',  parent: 'auto' },
  { slug: 'gps',                name: 'GPS',                    parent: 'auto' },

  { slug: 'sport',              name: 'Sport & Plein air',      icon: '🏕️' },
  { slug: 'fitness',            name: 'Entraînement',           parent: 'sport' },
  { slug: 'velo',               name: 'Vélo',                   parent: 'sport' },
  { slug: 'camping',            name: 'Camping & Pêche',        parent: 'sport' },
  { slug: 'sports-hiver',       name: 'Sports d\u2019hiver',    parent: 'sport' },

  { slug: 'jouets',             name: 'Jouets & Jeux',          icon: '🧸' },
  { slug: 'lego',               name: 'LEGO & Construction',    parent: 'jouets' },
  { slug: 'jeux-societe',       name: 'Jeux de société',        parent: 'jouets' },
  { slug: 'jouets-enfants',     name: 'Jouets pour enfants',    parent: 'jouets' },
  { slug: 'jouets-exterieur',   name: 'Jeux d’extérieur',       parent: 'jouets' },
  { slug: 'modelisme',          name: 'Modélisme & RC',         parent: 'jouets' },

  { slug: 'mode',               name: 'Mode & Accessoires',     icon: '👕' },
  { slug: 'bijoux',             name: 'Bijoux',                 parent: 'mode' },
  { slug: 'montres-mode',       name: 'Montres',                parent: 'mode' },
  { slug: 'accessoires-mode',   name: 'Accessoires',            parent: 'mode' },
  { slug: 'vetements',          name: 'Vêtements',              parent: 'mode' },
  { slug: 'bagages',            name: 'Bagages & Sacs',         parent: 'mode' },

  { slug: 'beaute-sante',       name: 'Beauté & Santé',         icon: '💄' },
  { slug: 'beaute-corps',       name: 'Beauté & Soins du corps',parent: 'beaute-sante' },
  { slug: 'soins-cheveux',      name: 'Soins capillaires',      parent: 'beaute-sante' },
  { slug: 'soins-dentaires',    name: 'Soins dentaires',        parent: 'beaute-sante' },
  { slug: 'massage',            name: 'Massage & Récupération', parent: 'beaute-sante' },
  { slug: 'bien-etre',          name: 'Bien-être',              parent: 'beaute-sante' },

  { slug: 'bebe',               name: 'Bébé & Enfant',          icon: '🍼' },
  { slug: 'poussettes',         name: 'Poussettes & Sièges',    parent: 'bebe' },
  { slug: 'mobilier-bebe',      name: 'Mobilier de chambre',    parent: 'bebe' },
  { slug: 'alimentation-bebe',  name: 'Alimentation',           parent: 'bebe' },
  { slug: 'moniteurs-bebe',     name: 'Moniteurs & Sécurité',   parent: 'bebe' },

  { slug: 'animaux',            name: 'Animaux',                icon: '🐾' },
  { slug: 'habitat-animaux',    name: 'Habitat & Transport',    parent: 'animaux' },
  { slug: 'alimentation-animaux', name: 'Alimentation & Gâteries', parent: 'animaux' },
  { slug: 'toilettage-animaux', name: 'Toilettage & Santé',     parent: 'animaux' },
  { slug: 'accessoires-animaux',name: 'Colliers & Laisses',     parent: 'animaux' },

  { slug: 'bureau',             name: 'Bureau & Papeterie',     icon: '📎' },
  { slug: 'encre-toner',        name: 'Encre & Toner',          parent: 'bureau' },
  { slug: 'papeterie',          name: 'Stylos & Papeterie',     parent: 'bureau' },
  { slug: 'rangement-bureau',   name: 'Classement & Rangement', parent: 'bureau' },
  { slug: 'papier',             name: 'Papier',                 parent: 'bureau' },

  { slug: 'epicerie',           name: 'Épicerie',               icon: '🛒' },
];

export const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export const TOP_CATEGORIES = CATEGORIES.filter((c) => !c.parent);

export const childrenOf = (slug: string) => CATEGORIES.filter((c) => c.parent === slug);

export function categoryName(slug: string | null | undefined): string {
  if (!slug) return 'Non classé';
  return CATEGORY_BY_SLUG.get(slug)?.name ?? slug;
}

/** Remonte à la catégorie racine d'un slug (utile pour le regroupement UI). */
export function rootOf(slug: string): string {
  const c = CATEGORY_BY_SLUG.get(slug);
  return c?.parent ? rootOf(c.parent) : slug;
}
