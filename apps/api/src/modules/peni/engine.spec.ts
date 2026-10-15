import { durationForDeadline, EngineContext, EngineResult, handleInput, InvalidChoiceError, PeniCatalog, startConversation } from './engine';

const catalog = (templates: PeniCatalog['templates'] = []): PeniCatalog => ({
  categories: [
    {
      code: 'sport',
      label: 'Sport',
      goals: [
        { code: 'sport_perte_poids', label: 'Perte de poids', quantityUnit: 'kg', quantityMin: 1, quantityMax: 30 },
        { code: 'sport_fessiers', label: 'Fessiers', quantityUnit: null, quantityMin: null, quantityMax: null },
        { code: 'sport_abdos', label: 'Abdos', quantityUnit: null, quantityMin: null, quantityMax: null },
        { code: 'sport_prise_masse', label: 'Prise de masse', quantityUnit: 'kg', quantityMin: 1, quantityMax: 15 },
        { code: 'sport_remise_forme', label: 'Remise en forme', quantityUnit: null, quantityMin: null, quantityMax: null },
      ],
    },
    { code: 'style_look', label: 'Style & look', goals: [] },
    { code: 'visage_peau', label: 'Visage & peau', goals: [] },
    { code: 'maquillage', label: 'Maquillage', goals: [] },
    { code: 'bien_etre_spa', label: 'Bien-être & spa', goals: [] },
  ],
  durationsDays: [30, 60, 90],
  budgetTiers: { small: '≈ 10 000 F', medium: '≈ 35 000 F', boosted: '75 000 F +' },
  templates,
});

const ctx = (over: Partial<EngineContext> = {}): EngineContext => ({ catalog: catalog(), today: '2026-10-15', firstName: 'Yannick', ...over });

/** Enchaîne les messages ; renvoie le dernier résultat. */
function talk(c: EngineContext, ...inputs: Array<string | { choice: string }>): EngineResult {
  let r = startConversation(c);
  for (const i of inputs) r = handleInput(r.state, typeof i === 'string' ? { text: i } : i, c);
  return r;
}
const last = (r: EngineResult) => r.replies[r.replies.length - 1];

describe('Peni : discussion guidée (lot 3, sans modèle de langage)', () => {
  it('accueil avec le prénom et les domaines en réponses rapides', () => {
    const r = startConversation(ctx());
    expect(r.replies).toHaveLength(1);
    expect(r.replies[0].text).toBe('Coucou Yannick ! 🥰 Raconte-moi : qu’est-ce que tu aimerais changer ?');
    expect(r.replies[0].quickReplies.map((q) => q.id)).toEqual(['cat:sport', 'cat:style_look', 'cat:visage_peau', 'cat:maquillage', 'cat:bien_etre_spa']);
    expect(r.state.step).toBe('category');
    expect(r.draft).toBeNull();
  });

  it('conversation de la maquette 25 : phrases libres comprises, brouillon au format de POST /v1/projects', () => {
    const c = ctx();
    let r = talk(c, 'Je veux perdre du ventre avant mon mariage en décembre. Mais j’ai pas trop le temps la semaine 😅');
    expect(r.state.slots).toMatchObject({ categoryCode: 'sport', goalCode: 'sport_abdos', deadlineDays: 47 });
    expect(last(r).text).toBe('Félicitations pour le mariage !! 💍 On a environ 7 semaines, c’est parfait. Combien de fois par semaine peux-tu t’y mettre ?');
    expect(r.state.step).toBe('sessions');

    r = handleInput(r.state, { text: 'En salle, le samedi et le dimanche matin' }, c);
    expect(r.state.slots).toMatchObject({ sessionsPerWeek: 2, availability: 'morning' });
    expect(r.state.step).toBe('mode');

    r = handleInput(r.state, { choice: 'mode:premium' }, c);
    expect(r.state.step).toBe('budget');
    expect(last(r).quickReplies.map((q) => q.label)).toEqual(['Petit · ≈ 10 000 F', 'Moyen · ≈ 35 000 F', 'Boosté · 75 000 F +']);

    r = handleInput(r.state, { choice: 'budget:medium' }, c);
    // 47 jours avant l'échéance : le programme le plus long qui tient (30 jours).
    expect(r.state.step).toBe('done');
    expect(r.draft).toEqual({
      mode: 'premium',
      budget: 'medium',
      categoryCode: 'sport',
      goalCode: 'sport_abdos',
      description: 'Je veux perdre du ventre avant mon mariage en décembre. Mais j’ai pas trop le temps la semaine 😅',
      sessionsPerWeek: 2,
      availability: 'morning',
      durationDays: 30,
    });
    expect(last(r)).toMatchObject({ text: 'Top ! J’ai noté tout ça 👇', pose: 'cheer', quickReplies: [{ id: 'restart', label: 'Recommencer' }] });
    expect(last(r).summary).toEqual([
      { label: 'Catégorie', value: 'Sport · Abdos' },
      { label: 'Durée', value: '30 jours' },
      { label: 'Séances', value: '2 / semaine' },
      { label: 'Moment', value: 'Le matin' },
      { label: 'Mode', value: 'Premium · moyen' },
    ]);
  });

  it('modèle de programme validé : sa durée s’impose, pas de question sur la durée', () => {
    const c = ctx({ catalog: catalog([{ categoryCode: 'sport', goalCode: 'sport_abdos', mode: 'any', status: 'published', durationDays: 70 }]) });
    const r = talk(c, 'Je veux des abdos', { choice: 'sessions:2' }, { choice: 'avail:morning' }, { choice: 'mode:eco' });
    expect(r.state.step).toBe('done');
    expect(r.draft).toEqual({ mode: 'eco', categoryCode: 'sport', goalCode: 'sport_abdos', description: 'Je veux des abdos', sessionsPerWeek: 2, availability: 'morning' });
    expect(last(r).summary).toContainEqual({ label: 'Durée', value: '70 jours' });
  });

  it('uniquement avec les boutons : domaine sans liste d’objectifs, description demandée, durée choisie', () => {
    const c = ctx();
    let r = talk(c, { choice: 'cat:maquillage' });
    expect(r.state.step).toBe('describe');
    expect(last(r).quickReplies).toEqual([]);
    r = handleInput(r.state, { text: 'Apprendre à me maquiller pour le travail' }, c);
    expect(r.state.step).toBe('sessions');
    for (const choice of ['sessions:3', 'avail:afternoon', 'mode:eco']) r = handleInput(r.state, { choice }, c);
    expect(r.state.step).toBe('duration');
    expect(last(r).quickReplies.map((q) => q.id)).toEqual(['dur:30', 'dur:60', 'dur:90']);
    r = handleInput(r.state, { choice: 'dur:60' }, c);
    expect(r.draft).toEqual({ mode: 'eco', categoryCode: 'maquillage', description: 'Apprendre à me maquiller pour le travail', sessionsPerWeek: 3, availability: 'afternoon', durationDays: 60 });
  });

  it('objectif chiffré : « perdre 8 kg » compris ; une valeur hors limites redemande la quantité', () => {
    const c = ctx();
    expect(talk(c, 'Je voudrais perdre 8 kg').state.slots).toMatchObject({ categoryCode: 'sport', goalCode: 'sport_perte_poids', targetQuantity: 8 });
    let r = talk(c, 'Je veux maigrir, 50 kilos');
    expect(r.state.step).toBe('quantity');
    expect(last(r).text).toBe('Combien de kg aimerais-tu perdre ? (entre 1 et 30)');
    r = handleInput(r.state, { text: '12' }, c);
    expect(r.state.slots.targetQuantity).toBe(12);
    expect(talk(c, 'Je veux prendre 3 kilos de muscle').state.slots).toMatchObject({ goalCode: 'sport_prise_masse', targetQuantity: 3 });
  });

  it('séances et moments en français courant', () => {
    const c = ctx();
    const slots = (t: string) => talk(c, 'Je veux des abdos', t).state.slots;
    expect(slots('3 fois par semaine le soir')).toMatchObject({ sessionsPerWeek: 3, availability: 'afternoon' });
    expect(slots('deux séances, à midi')).toMatchObject({ sessionsPerWeek: 2, availability: 'noon' });
    expect(slots('tous les jours après-midi')).toMatchObject({ sessionsPerWeek: 7, availability: 'afternoon' });
    expect(slots('le week-end')).toMatchObject({ sessionsPerWeek: 2 });
    expect(slots('lundi, mercredi et vendredi')).toMatchObject({ sessionsPerWeek: 3 });
    expect(slots('4')).toMatchObject({ sessionsPerWeek: 4 }); // nombre seul : seulement en réponse à la question des séances
  });

  it('santé : aucun avis médical, conseil d’un professionnel, la discussion continue', () => {
    const r = talk(ctx(), 'Je veux maigrir mais j’ai mal au genou');
    expect(r.replies).toHaveLength(2);
    expect(r.replies[0]).toMatchObject({ safety: 'health', pose: 'think' });
    expect(r.replies[0].text).toContain('Je ne peux pas donner d’avis médical');
    expect(r.replies[0].text).toContain('professionnel de santé');
    expect(r.state.slots).toMatchObject({ categoryCode: 'sport', goalCode: 'sport_perte_poids' });
    expect(talk(ctx(), 'Je suis enceinte et je veux me remettre en forme').replies[0].safety).toBe('health');
  });

  it('urgence : numéros du SAMU (185) et des pompiers (180), le projet n’avance pas', () => {
    const c = ctx();
    const r = talk(c, 'Je veux des abdos', 'en fait j’ai envie de mourir');
    expect(r.replies).toHaveLength(1);
    expect(r.replies[0]).toMatchObject({ safety: 'urgent', quickReplies: [{ id: 'continue', label: 'Reprendre mon projet' }] });
    expect(r.replies[0].text).toContain('185');
    expect(r.replies[0].text).toContain('180');
    expect(r.state.slots.sessionsPerWeek).toBeUndefined();
    const back = handleInput(r.state, { choice: 'continue' }, c);
    expect(last(back).text).toBe('Combien de fois par semaine peux-tu t’y mettre ?');
  });

  it('message incompris : Peni le dit et repose la question avec les boutons ; rien n’est retenu', () => {
    const r = talk(ctx(), 'salut');
    expect(last(r).text).toBe('Je n’ai pas bien compris 😅 C’est plutôt dans quel domaine ? Choisis ci-dessous 👇');
    expect(last(r).quickReplies).toHaveLength(5);
    expect(r.state.slots).toEqual({});
    expect(r.state.misses).toBe(1);
  });

  it('seules les réponses rapides proposées sont acceptées', () => {
    const r = startConversation(ctx());
    expect(() => handleInput(r.state, { choice: 'mode:eco' }, ctx())).toThrow(InvalidChoiceError);
    expect(() => handleInput(r.state, { choice: 'cat:inconnue' }, ctx())).toThrow(InvalidChoiceError);
  });

  it('mode déjà choisi à l’écran 19 : pas de question sur le mode ; « Recommencer » repart de zéro', () => {
    const c = ctx();
    let r = startConversation(c, { mode: 'premium', budget: 'small' });
    for (const i of [{ text: 'des fessiers' }, { choice: 'sessions:4' }, { choice: 'avail:morning' }, { choice: 'dur:90' }]) r = handleInput(r.state, i, c);
    expect(r.draft).toMatchObject({ mode: 'premium', budget: 'small', goalCode: 'sport_fessiers', durationDays: 90 });
    const again = handleInput(r.state, { choice: 'restart' }, c);
    expect(again.state.slots).toEqual({});
    expect(again.state.step).toBe('category');
    expect(again.draft).toBeNull();
  });

  it('après le résumé, un message libre rappelle que le programme est prêt', () => {
    const c = ctx();
    const done = talk(c, 'des fessiers', { choice: 'sessions:4' }, { choice: 'avail:morning' }, { choice: 'mode:eco' }, { choice: 'dur:30' });
    const r = handleInput(done.state, { text: 'merci !' }, c);
    expect(last(r).text).toBe('Ton programme est prêt 👇 Vérifie-le avec « Voir mon programme », ou recommence.');
    expect(r.draft).toEqual(done.draft);
  });

  it('échéance : durée la plus longue qui tient avant la date, sinon la plus courte', () => {
    expect(durationForDeadline(47, [30, 60, 90])).toBe(30);
    expect(durationForDeadline(75, [90, 30, 60])).toBe(60);
    expect(durationForDeadline(10, [30, 60, 90])).toBe(30);
    // Mois en cours : fin du mois ; mois passé : l'année suivante.
    expect(talk(ctx(), 'des abdos pour octobre').state.slots.deadlineDays).toBe(17);
    expect(talk(ctx(), 'des abdos pour mars').state.slots.deadlineDays).toBe(137);
  });
});
