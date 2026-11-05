import { CONTENT } from '../../../shared/src';
import type { Env } from '../env';
import { loadConfig } from '../config';
import { dispatch } from '../util/http';

/**
 * WorldDO：全体で1つ。チャンネルの割り当て、ワールド通知、侵攻・フィールドボスの予定、救援の一覧。
 */
export class WorldDO {
  private channels = new Map<string, { n: number; at: number }>();
  private cfg;
  constructor(private state: DurableObjectState, env: Env) {
    this.cfg = loadConfig(env);
    void this.state;
  }

  async fetch(req: Request): Promise<Response> {
    return dispatch(req, {
      /** そのエリアの空いているチャンネル */
      assign: (b: { area: string }) => {
        const area = CONTENT.areas[b.area] ? b.area : CONTENT.balance.world.startArea;
        const now = Date.now();
        for (let ch = 1; ch < 100; ch++) {
          const key = `${area}#${ch}`;
          const c = this.channels.get(key);
          // 報告が古いチャンネルは空いているとみなす
          if (!c || now - c.at > 120000 || c.n < this.cfg.channelCap) {
            this.channels.set(key, { n: (c && now - c.at <= 120000 ? c.n : 0) + 1, at: now });
            return { key };
          }
        }
        return { key: `${area}#1` };
      },
      population: (b: { key: string; n: number }) => { this.channels.set(b.key, { n: b.n, at: Date.now() }); return { ok: true }; },
      channels: () => ({ channels: [...this.channels.entries()].map(([key, v]) => ({ key, ...v })) }),
    });
  }
}
