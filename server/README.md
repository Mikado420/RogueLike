# server（予定）

段階3で Cloudflare Workers ＋ Durable Objects を使ってオンライン化する。

- 1つのフィールド（マップ）＝1つの Durable Object。中で `shared/src/sim.ts` の `step()` を 20tick/秒で回す（サーバー権威型）
- クライアントは `PlayerInput`（移動ベクトル・狙い・攻撃・スキル・回避・コマンド）だけを WebSocket で送る
- サーバーは状態の差分と `GameEvent` を送り返し、クライアントは補間して描く
- 乱数はワールドごとのシード付き `Rng` をサーバーだけが進める
