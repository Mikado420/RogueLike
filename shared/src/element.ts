import type { Element } from './core';
import type { Balance } from './content/types';
import { CONTENT } from './content';

/**
 * 属性相性。攻撃側 atk が防御側 def に与えるときの倍率。
 * cycle は「前が次に強い」並び（火→風→地→水→火）。mutual の組は互いに有利。
 */
export function affinity(atk: Element, def: Element, eb: Balance['element'] = CONTENT.balance.element): number {
  if (atk === 'neutral' || def === 'neutral') return eb.neutral;
  for (const [a, b] of eb.mutual) {
    if ((atk === a && def === b) || (atk === b && def === a)) return eb.advantage;
  }
  const n = eb.cycle.length;
  const ia = eb.cycle.indexOf(atk);
  const id = eb.cycle.indexOf(def);
  if (ia < 0 || id < 0) return eb.neutral;
  if ((ia + 1) % n === id) return eb.advantage;
  if ((id + 1) % n === ia) return eb.disadvantage;
  return eb.neutral;
}
