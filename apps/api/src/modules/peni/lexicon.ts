/**
 * Vocabulaire de Peni pour la discussion guidée (lot 3, sans modèle de langage) : mots-clés versionnés dans le dépôt.
 * Le texte est comparé sans accents ni majuscules. Les catégories et objectifs viennent de la base (administrables) ;
 * un objectif absent de ce vocabulaire reste proposé par les boutons de réponse rapide.
 */

/** Minuscules, sans accents, apostrophes et tirets remplacés par des espaces, espaces simples. */
export function normalize(text: string): string {
  return ` ${text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`´\-_/]/g, ' ')
    .replace(/[^a-z0-9%\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/** Vrai si l'un des mots ou expressions (déjà normalisés, sans accents) apparaît comme mot entier. */
export function hasAny(normalized: string, words: readonly string[]): boolean {
  return words.some((w) => normalized.includes(` ${w} `));
}

export const CATEGORY_WORDS: Record<string, readonly string[]> = {
  sport: [
    'sport', 'muscu', 'musculation', 'abdos', 'abdo', 'ventre', 'bidon', 'maigrir', 'mincir', 'poids', 'kilo', 'kilos', 'kg', 'courir', 'course',
    'cardio', 'endurance', 'fesses', 'fessiers', 'bras', 'biceps', 'pecs', 'pectoraux', 'cuisses', 'souplesse', 'etirements', 'forme', 'fitness',
    'prise de masse', 'grossir', 'muscles', 'muscle',
  ],
  style_look: ['style', 'look', 'tenue', 'tenues', 'vetements', 'habiller', 'garde robe', 'sape', 'saper', 'mode vestimentaire'],
  visage_peau: ['peau', 'visage', 'acne', 'boutons', 'taches', 'teint', 'rides', 'cernes', 'points noirs'],
  cheveux_coiffure: ['cheveux', 'coiffure', 'tresses', 'perruque', 'locks', 'cuir chevelu', 'defrisage', 'tissage'],
  ongles_mains: ['ongles', 'manucure', 'mains', 'vernis', 'pedicure'],
  maquillage: ['maquillage', 'maquiller', 'make up', 'makeup'],
  bien_etre_spa: ['stress', 'stresse', 'detente', 'detendre', 'relaxer', 'relax', 'massage', 'spa', 'sommeil', 'dormir', 'bien etre', 'zen'],
};

/** Objectifs de la catégorie Sport (migration 0005). L'ordre compte : le premier objectif trouvé l'emporte. */
export const GOAL_WORDS: Record<string, readonly string[]> = {
  sport_prise_masse: ['prise de masse', 'prendre du poids', 'grossir', 'prendre de la masse'],
  sport_abdos: ['ventre', 'abdos', 'abdo', 'abdominaux', 'bidon', 'tablette', 'tablettes de chocolat'],
  sport_perte_poids: ['maigrir', 'mincir', 'perdre du poids', 'perte de poids', 'perdre des kilos', 'kilos en trop'],
  sport_fessiers: ['fesses', 'fessiers', 'fessier'],
  sport_pectoraux: ['pecs', 'pectoraux', 'torse'],
  sport_bras: ['bras', 'biceps', 'triceps'],
  sport_cuisses: ['cuisses', 'jambes'],
  sport_cardio: ['cardio', 'endurance', 'souffle', 'courir'],
  sport_souplesse: ['souplesse', 'etirements', 'souple'],
  sport_remise_forme: ['remise en forme', 'remettre en forme', 'reprendre le sport', 'forme'],
};

export const NUMBER_WORDS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7 };

export const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

export const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'] as const;

/**
 * Sujets de santé : Peni ne donne aucun avis médical et oriente vers un professionnel (règle R4). Liste volontairement
 * large : mieux vaut un rappel de prudence de trop qu'un conseil sportif à une personne enceinte ou blessée.
 */
export const HEALTH_WORDS = [
  'douleur', 'douleurs', 'mal au', 'mal a la', 'mal aux', 'blessure', 'blesse', 'blessee', 'malade', 'maladie', 'enceinte', 'grossesse', 'allaite',
  'allaitement', 'diabete', 'diabetique', 'tension', 'hypertension', 'cardiaque', 'asthme', 'asthmatique', 'operation', 'opere', 'operee',
  'medicament', 'medicaments', 'traitement', 'hernie', 'entorse', 'fracture', 'anorexie', 'boulimie', 'vomir', 'jeuner', 'regime strict',
  'drepanocytose', 'epilepsie', 'medecin', 'docteur', 'eczema', 'allergie', 'allergique',
] as const;

/** Situations urgentes : Peni donne les numéros d'urgence (SAMU 185, pompiers 180) et ne poursuit pas le projet. */
export const URGENT_WORDS = [
  'suicide', 'suicider', 'me tuer', 'en finir', 'envie de mourir', 'veux mourir', 'me faire du mal', 'douleur a la poitrine', 'douleur dans la poitrine',
  'mal a la poitrine', 'je saigne', 'evanoui', 'evanouie', 'je n arrive plus a respirer', 'respire plus',
] as const;

/** Hésitation : jamais retenue comme objectif « avec ses mots » ; Peni repropose les objectifs de la liste. */
export const UNSURE_WORDS = ['sais pas', 'sait pas', 'aucune idee', 'pas sur', 'pas sure', 'hesite', 'j hesite', 'aide moi', 'je ne vois pas', 'peu importe', 'n importe'] as const;
