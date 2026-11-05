import { describe, expect, it } from 'vitest';
import { deserializeAccount, migrateAccount, MIGRATIONS, newAccount, newCharacter, SAVE_VERSION, serializeAccount } from '../src/save';
import { makeWorld, tick } from './helpers';
import { syncCharacters } from '../src/systems/world';

describe('セーブデータ', () => {
  it('アカウント → キャラクターの形で、書き出して読み戻せる', () => {
    const acc = newAccount(1, 2);
    const a = newCharacter(acc, 'A', { body: 1, hair: 2 }, 1);
    newCharacter(acc, 'B', { body: 0, hair: 0 }, 2);
    const back = deserializeAccount(serializeAccount(acc));
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.characters.map((c) => c.name)).toEqual(['A', 'B']);
    expect(back.characters[0].equipment.weapon?.uid).toBe(a.equipment.weapon?.uid);
  });

  it('新しすぎる版は読み込まない', () => {
    const acc = newAccount(1, 2);
    expect(() => migrateAccount({ ...acc, version: SAVE_VERSION + 1 })).toThrow();
    expect(() => migrateAccount(null)).toThrow();
  });

  it('古い版はマイグレーション関数を順に通る', () => {
    const acc = newAccount(1, 2);
    newCharacter(acc, 'A', { body: 0, hair: 0 }, 1);
    const old = JSON.parse(serializeAccount(acc));
    old.version = SAVE_VERSION - 1;
    const prev = MIGRATIONS[SAVE_VERSION - 1];
    MIGRATIONS[SAVE_VERSION - 1] = (d) => ({ ...(prev ? prev(d) : d), migrated: true });
    try {
      const m = migrateAccount(old) as unknown as { migrated: boolean; version: number };
      expect(m.migrated).toBe(true);
      expect(m.version).toBe(SAVE_VERSION);
    } finally {
      if (prev) MIGRATIONS[SAVE_VERSION - 1] = prev; else delete MIGRATIONS[SAVE_VERSION - 1];
    }
  });

  it('足りない項目は既定値で埋まる', () => {
    const acc = newAccount(1, 2);
    const ch = newCharacter(acc, 'A', { body: 0, hair: 0 }, 1) as unknown as Record<string, unknown>;
    delete ch.counters; delete ch.builds; delete ch.bag;
    const m = migrateAccount(JSON.parse(JSON.stringify(acc)));
    expect(m.characters[0].counters).toEqual({});
    expect(m.characters[0].builds.length).toBeGreaterThan(0);
    expect(m.characters[0].bag).toEqual({});
  });

  it('遊んだ結果（位置・レベル）が保存され、読み込むと同じ場所から始まる', async () => {
    const { w, p, acc } = makeWorld(21);
    tick(w, p, { move: { x: 1, y: 0 } }, 20);
    p.char.level = 7;
    syncCharacters(w);
    const back = deserializeAccount(serializeAccount(acc));
    const ch = back.characters[0];
    expect(ch.level).toBe(7);
    expect(ch.location.x).toBeCloseTo(p.x, 5);
    const { createWorld } = await import('../src/systems/world');
    const w2 = createWorld({ account: back, characterId: ch.id, seed: 5 });
    expect(w2.players[0].x).toBeCloseTo(p.x, 5);
  });
});
