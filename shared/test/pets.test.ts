import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/content';
import { addToBag } from '../src/systems/items';
import { capture, inheritPet, petMods } from '../src/systems/pets';
import { migrateAccount, newAccount, newCharacter, serializeAccount } from '../src/save';
import { makeTraining, spawnAt, tick } from './helpers';
import type { PetData } from '../src/state';

const C = CONTENT;

describe('ペット', () => {
  it('弱らせないと捕まえられない。弱らせて封晶石を使うと仲間になる', () => {
    const { w, p } = makeTraining('oneHandSword', 20, 8, 1);
    addToBag(p.char, 'seal_stone', 50);
    let m = spawnAt(w, 'boar', p.x + 1.2, p.y, 10);
    expect(capture(w, p, 'seal_stone')).toBe('err.notWeak');
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      if (m.dead) m = spawnAt(w, 'boar', p.x + 1.2, p.y, 10);
      m.hp = Math.round(m.stats.maxHp * 0.05);
      ok = capture(w, p, 'seal_stone') === null;
    }
    expect(ok).toBe(true);
    expect(p.char.pets.length).toBe(1);
    expect(p.char.activePet).toBe(p.char.pets[0].uid);
    expect(p.char.counters.captures).toBe(1);
    const boss = spawnAt(w, 'ignaros', p.x + 1.5, p.y, 10);
    boss.hp = 1;
    w.area.monsters = w.area.monsters.filter((x) => x === boss);
    expect(capture(w, p, 'seal_stone')).toBe('err.cantCapture');
  });

  it('戦闘のペットはついてきて敵を攻撃し、倒すと持ち主とペットに経験値', () => {
    const { w, p, ch } = makeTraining('oneHandSword', 20, 30, 2);
    const pet: PetData = { uid: 777, species: 'boar', name: 'ボア', level: 20, exp: 0, skills: ['rock_throw'], role: 'battle', elite: false };
    ch.pets.push(pet);
    ch.activePet = 777;
    tick(w, p);
    expect(w.pets.length).toBe(1);
    const m = spawnAt(w, 'slime', p.x + 3, p.y, 5);
    m.ai = 'wander';
    let petHit = false;
    for (let i = 0; i < 400 && !m.dead; i++) {
      tick(w, p);
      if (w.events.some((e) => e.type === 'damage' && e.src === w.pets[0].id)) petHit = true;
    }
    expect(petHit).toBe(true);
    expect(m.dead).toBe(true);
    expect(ch.exp).toBeGreaterThan(0);
    expect(pet.exp + pet.level).toBeGreaterThan(20);
  });

  it('採集の役割とパッシブスキルは持ち主に補正を与える', () => {
    const { w, p, ch } = makeTraining('oneHandSword', 20, 30, 3);
    ch.pets.push({ uid: 5, species: 'shroom', name: 'm', level: 5, exp: 0, skills: ['lucky'], role: 'gather', elite: false });
    ch.activePet = 5;
    const m = petMods(w, p);
    expect(m.gatherPct).toBe(C.pets.gatherBonus);
    expect(m.rareRatePct).toBe(C.pets.skills.lucky.mods!.rareRatePct);
  });

  it('継承：素材のペットのスキルを受け継ぎ、素材は消える', () => {
    const { w, p, ch } = makeTraining('oneHandSword', 20, 30, 4);
    ch.pets.push({ uid: 1, species: 'boar', name: 'a', level: 10, exp: 0, skills: ['rock_throw'], role: 'battle', elite: false });
    ch.pets.push({ uid: 2, species: 'fairy', name: 'b', level: 10, exp: 0, skills: ['holy_light'], role: 'battle', elite: false });
    ch.gold = 0;
    expect(inheritPet(w, p, 1, 2, 'holy_light', 1)).toBe('err.gold');
    ch.gold = 1e6;
    expect(inheritPet(w, p, 1, 2, 'war_cry', 1)).toBe('err.invalid');
    expect(inheritPet(w, p, 1, 2, 'holy_light', 1)).toBeNull();
    expect(ch.pets.length).toBe(1);
    expect(ch.pets[0].skills).toEqual(['rock_throw', 'holy_light']);
  });

  it('セーブ版6：ペットの欄が足される', () => {
    const acc = newAccount(1, 2);
    newCharacter(acc, 'A', { body: 0, hair: 0 }, 1);
    const raw = JSON.parse(serializeAccount(acc));
    raw.version = 5;
    for (const ch of raw.characters) { delete ch.pets; delete ch.activePet; }
    const m = migrateAccount(raw);
    expect(m.characters[0].pets).toEqual([]);
    expect(m.characters[0].activePet).toBeNull();
  });
});
