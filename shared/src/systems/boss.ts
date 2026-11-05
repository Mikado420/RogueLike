import type { Monster, World } from '../state';

/**
 * ボス・レイドの仕掛け（フェーズ・召喚・シールド・安全地帯）が入る場所。
 * M5 で中身を実装する。
 */
export const bossHooks = {
  update(_w: World, _m: Monster): void {},
  speedMul(_w: World, _m: Monster): number { return 1; },
};
