# server

Cloudflare Workers ＋ Durable Objects（SQLite）＋ D1 のサーバー。構成と API はリポジトリの README の「構成」「管理用 API」、
準備は `docs/SETUP.md`、無料枠の見積もりは `docs/COST.md`。

- `src/index.ts`：Worker（HTTP API・WebSocket の振り分け・管理用 API）
- `src/do/`：AreaDO・InstanceDO（step を回す）、AccountDO（正のデータ・郵便受け）、WorldDO、ChatDO、PartyDO、GuildDO、MarketDO
- `config.json`：tick・送信頻度・人数・関心範囲など（環境変数 `CONFIG` で上書き）
- `test/`：Node の中の疑似 Cloudflare（`runtime.ts`）とテスト用の client（`client.ts`）。`npm test` で一緒に動く
