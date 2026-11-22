import { describe, it, expect } from 'vitest';
import { validateCommanderDeck, isCommanderEligible, isAlternativeCommander, checkPair, type DeckEntry } from '../src/decks/validateCommander.js';

const card = (name: string, o: Partial<DeckEntry> = {}): DeckEntry => ({
  name, qty: 1, board: 'main', typeLine: 'Artifact', oracleText: '', colorIdentity: [], commanderLegality: 'legal', gameChanger: false, ...o,
});
const atraxa = card("Atraxa, Praetors' Voice", { board: 'commander', typeLine: 'Legendary Creature — Phyrexian Angel Horror', colorIdentity: ['W', 'U', 'B', 'G'], power: '4' });
const filler = (n: number, o: Partial<DeckEntry> = {}) => Array.from({ length: n }, (_, i) => card(`Filler ${i}`, o));
const forest = (qty: number) => card('Forest', { qty, typeLine: 'Basic Land — Forest', colorIdentity: ['G'] });

describe('validateCommanderDeck', () => {
  it('accepts a legal 100-card deck', () => {
    const r = validateCommanderDeck([atraxa, ...filler(60), forest(39)]);
    expect(r.count).toBe(100);
    expect(r.legal).toBe(true);
    expect(r.colorIdentity).toEqual(['W', 'U', 'B', 'G']);
  });

  it('rejects 99 cards and 101 cards', () => {
    expect(validateCommanderDeck([atraxa, ...filler(60), forest(38)]).issues.find(i => i.code === 'size')?.message).toMatch(/99 \/ 100.*add 1/);
    expect(validateCommanderDeck([atraxa, ...filler(60), forest(40)]).issues.find(i => i.code === 'size')?.message).toMatch(/101 \/ 100.*remove 1/);
  });

  it('flags duplicate non-basic cards', () => {
    const r = validateCommanderDeck([atraxa, ...filler(58), card('Sol Ring', { qty: 2 }), forest(39)]);
    expect(r.legal).toBe(false);
    expect(r.issues.find(i => i.code === 'singleton')?.cards).toEqual(['Sol Ring']);
  });

  it('allows any number of Relentless Rats and up to seven Seven Dwarves', () => {
    const rats = card('Relentless Rats', { qty: 30, colorIdentity: ['B'], oracleText: 'Relentless Rats gets +1/+1...\nA deck can have any number of cards named Relentless Rats.' });
    expect(validateCommanderDeck([atraxa, rats, ...filler(30), forest(39)]).legal).toBe(true);
    const dwarves = (qty: number) => card('Seven Dwarves', { qty, colorIdentity: ['R'], oracleText: 'A deck can have up to seven cards named Seven Dwarves.' });
    const krenko = card('Krenko, Mob Boss', { board: 'commander', typeLine: 'Legendary Creature — Goblin Warrior', colorIdentity: ['R'] });
    const mountain = (q: number) => card('Mountain', { qty: q, typeLine: 'Basic Land — Mountain', colorIdentity: ['R'] });
    expect(validateCommanderDeck([krenko, dwarves(7), ...filler(52), mountain(40)]).legal).toBe(true);
    expect(validateCommanderDeck([krenko, dwarves(8), ...filler(51), mountain(40)]).issues.some(i => i.code === 'singleton')).toBe(true);
  });

  it('flags cards outside the color identity', () => {
    const bolt = card('Lightning Bolt', { colorIdentity: ['R'] });
    const r = validateCommanderDeck([atraxa, bolt, ...filler(59), forest(39)]);
    expect(r.issues.find(i => i.code === 'color-identity')?.cards).toEqual(['Lightning Bolt']);
  });

  it('flags banned cards', () => {
    const r = validateCommanderDeck([atraxa, card('Mana Crypt', { commanderLegality: 'banned' }), ...filler(59), forest(39)]);
    expect(r.issues.find(i => i.code === 'banned')?.cards).toEqual(['Mana Crypt']);
  });

  it('requires a commander and checks eligibility', () => {
    expect(validateCommanderDeck([...filler(61), forest(39)]).issues.some(i => i.code === 'no-commander')).toBe(true);
    const notLegendary = card('Llanowar Elves', { board: 'commander', typeLine: 'Creature — Elf Druid', colorIdentity: ['G'] });
    expect(validateCommanderDeck([notLegendary, ...filler(60), forest(39)]).issues.some(i => i.code === 'ineligible-commander')).toBe(true);
  });

  it('accepts legendary vehicles, spacecraft with P/T, and "can be your commander"', () => {
    expect(isCommanderEligible(card('Parhelion II', { typeLine: 'Legendary Artifact — Vehicle', power: '5' }))).toBe(true);
    expect(isCommanderEligible(card('Some Ship', { typeLine: 'Legendary Artifact — Spacecraft', power: '6' }))).toBe(true);
    expect(isCommanderEligible(card('Station', { typeLine: 'Legendary Artifact — Spacecraft', power: null }))).toBe(false);
    expect(isCommanderEligible(card('Teferi, Temporal Archmage', { typeLine: 'Legendary Planeswalker — Teferi', oracleText: 'Teferi, Temporal Archmage can be your commander.' }))).toBe(true);
    expect(isCommanderEligible(card('Sol Ring'))).toBe(false);
  });

  it('checks partner pairs', () => {
    const p = (name: string, text: string, typeLine = 'Legendary Creature — Human') => card(name, { board: 'commander', typeLine, oracleText: text });
    expect(checkPair(p('Thrasios', 'Partner (You can have two commanders if both have partner.)'), p('Tymna', 'Partner'))).toBeNull();
    expect(checkPair(p('Pir, Imaginative Rascal', 'Partner with Toothy, Imaginary Friend (When this creature enters...)'),
      p('Toothy, Imaginary Friend', 'Partner with Pir, Imaginative Rascal'))).toBeNull();
    expect(checkPair(p('Pir, Imaginative Rascal', 'Partner with Toothy, Imaginary Friend'), p('Tymna', 'Partner'))).not.toBeNull();
    expect(checkPair(p('Atraxa', ''), p('Tymna', 'Partner'))).not.toBeNull();
    expect(checkPair(p('Wilson, Refined Grizzly', 'Choose a Background'), p('Raised by Giants', 'Commander creatures you own...', 'Legendary Enchantment — Background'))).toBeNull();
    expect(checkPair(p('Donna Noble', "Doctor's companion"), p('The Tenth Doctor', '', 'Legendary Creature — Time Lord Doctor'))).toBeNull();
    expect(checkPair(p('Will', 'Friends forever'), p('Mike', 'Friends forever'))).toBeNull();
  });

  it('a Background paired with a "Choose a Background" commander is legal', () => {
    const wilson = card('Wilson, Refined Grizzly', { board: 'commander', typeLine: 'Legendary Creature — Bear Warrior', oracleText: 'Choose a Background', colorIdentity: ['G'] });
    const bg = card('Raised by Giants', { board: 'commander', typeLine: 'Legendary Enchantment — Background', colorIdentity: ['G'] });
    const r = validateCommanderDeck([wilson, bg, ...filler(59), forest(39)]);
    expect(r.legal).toBe(true);
  });

  it('counts Game Changers against the target bracket', () => {
    const gcs = [0, 1, 2, 3].map(i => card(`GC ${i}`, { gameChanger: true }));
    const deck = [atraxa, ...gcs, ...filler(56), forest(39)];
    const r3 = validateCommanderDeck(deck, 3);
    expect(r3.gameChangers).toHaveLength(4);
    expect(r3.minimumBracket).toBe(4);
    expect(r3.issues.some(i => i.code === 'bracket')).toBe(true);
    expect(r3.legal).toBe(true); // bracket is advisory
    expect(validateCommanderDeck(deck, 4).issues.some(i => i.code === 'bracket')).toBe(false);
  });

  it('picks alternative commanders by colour identity, not by mana cost', () => {
    const WUBRG = ['W', 'U', 'B', 'R', 'G'];
    // Ashling costs {2}{R} but its abilities use every colour, so its identity is WUBRG.
    const ashling = card('Ashling, the Limitless', { typeLine: 'Legendary Creature — Elemental Sorcerer', colorIdentity: WUBRG });
    const horde = card('Horde of Notions', { typeLine: 'Legendary Creature — Elemental', colorIdentity: WUBRG });
    const jegantha = card('Jegantha, the Wellspring', { typeLine: 'Legendary Creature — Elemental Elk', colorIdentity: WUBRG });
    const muldrotha = card('Muldrotha, the Gravetide', { typeLine: 'Legendary Creature — Elemental Avatar', colorIdentity: ['B', 'G', 'U'] });
    const selvala = card('Selvala, Heart of the Wilds', { typeLine: 'Legendary Creature — Elf Scout', colorIdentity: ['G'] });
    const omnath = card('Omnath, Locus of Rage', { typeLine: 'Creature — Elemental', colorIdentity: WUBRG }); // not legendary
    const bolt = card('Lightning Bolt', { typeLine: 'Instant', colorIdentity: ['R'] });

    expect(isAlternativeCommander(horde, ashling.colorIdentity)).toBe(true);
    expect(isAlternativeCommander(jegantha, ashling.colorIdentity)).toBe(true);
    expect(isAlternativeCommander(muldrotha, ashling.colorIdentity)).toBe(false); // narrower identity
    expect(isAlternativeCommander(selvala, ashling.colorIdentity)).toBe(false);
    expect(isAlternativeCommander(omnath, ashling.colorIdentity)).toBe(false);    // not legendary
    expect(isAlternativeCommander(bolt, ashling.colorIdentity)).toBe(false);      // not a creature

    // A two-colour deck only accepts two-colour commanders of the same pair.
    const kwain = card('Kwain, Itinerant Meddler', { typeLine: 'Legendary Creature — Human Advisor', colorIdentity: ['W', 'U'] });
    expect(isAlternativeCommander(card('Alela', { typeLine: 'Legendary Creature — Faerie', colorIdentity: ['W', 'U'] }), kwain.colorIdentity)).toBe(true);
    expect(isAlternativeCommander(card('Mono blue', { typeLine: 'Legendary Creature — Bird', colorIdentity: ['U'] }), kwain.colorIdentity)).toBe(false);

    // Banned cards, "can be your commander" planeswalkers and legendary Vehicles are not offered.
    expect(isAlternativeCommander(card('Banned guy', { typeLine: 'Legendary Creature — Human', colorIdentity: WUBRG, commanderLegality: 'banned' }), WUBRG)).toBe(false);
    expect(isAlternativeCommander(card('Teferi, Temporal Archmage', { typeLine: 'Legendary Planeswalker — Teferi', colorIdentity: WUBRG, oracleText: 'Teferi, Temporal Archmage can be your commander.' }), WUBRG)).toBe(false);
    expect(isAlternativeCommander(card('Parhelion II', { typeLine: 'Legendary Artifact — Vehicle', colorIdentity: ['W'], power: '5' }), ['W'])).toBe(false);
    // Only the front face's type counts for a double-faced card.
    expect(isAlternativeCommander(card('Flip walker', { typeLine: 'Legendary Creature — Human // Legendary Planeswalker — Human', colorIdentity: WUBRG }), WUBRG)).toBe(true);
    expect(isAlternativeCommander(card('Back creature', { typeLine: 'Sorcery // Legendary Creature — Spirit', colorIdentity: WUBRG }), WUBRG)).toBe(false);
  });

  it('ignores the maybeboard and keeps a companion outside the 100', () => {
    const r = validateCommanderDeck([atraxa, ...filler(60), forest(39), card('Maybe', { board: 'maybe', qty: 5 }), card('Lurrus', { board: 'companion', colorIdentity: ['W', 'B'] })]);
    expect(r.count).toBe(100);
    expect(r.legal).toBe(true);
  });
});
