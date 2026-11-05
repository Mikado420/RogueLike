import type { TitleHooks } from './title';

/** 古いセーブの引き継ぎ（O4 で作る） */
export function registerMigration(): TitleHooks['migrate'] {
  return undefined;
}
