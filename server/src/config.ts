import base from '../config.json';
import type { Env } from './env';

export type ServerConfig = typeof base;

/**
 * サーバーの設定。server/config.json が既定値で、環境変数 CONFIG（JSON）で上書きできる。
 * 無料枠から有料プランに移るときは、ここ（tick・送信頻度・人数・関心範囲）を変えるだけでよい。
 */
export function loadConfig(env: Pick<Env, 'CONFIG'>): ServerConfig {
  if (!env.CONFIG) return base;
  try {
    const o = JSON.parse(env.CONFIG) as Partial<ServerConfig>;
    return { ...base, ...o, rate: { ...base.rate, ...(o.rate ?? {}) } };
  } catch {
    return base;
  }
}
