# 進捗（オンライン化・段階3）

マイルストーンごとに動く状態で push する。途中で止まったら、ここのチェックと「再開メモ」を見て続きから再開する。

## O1：shared を複数人対応にする
- [x] World を「1エリア＝1ワールド、中に何人でも」に。アカウント・移動先は Player 側（`p.account`・`p.transition`）、共有するもの（フィールドボスの区切り・侵攻の貢献度）は `w.shared`
- [x] アイテムの uid はワールドごとの乱数で 52bit（アカウントをまたいでも重ならない）。キャラ id はアカウント id 入り
- [x] GameEvent の宛先：`playerId` があるものは本人だけ、ないものはエリアの全員（`shared/src/host/audience.ts`）
- [x] エリア移動を「取り出す（`removePlayer`）→ 入れる（`addPlayer`）」に。ダンジョン・塔・レイドは `InstanceSpec` を渡して、行き先のワールドが自分で作る
- [x] `AreaHost`（1エリア×1チャンネル）と `LocalServer`（ローカル疑似サーバー：チャンネル分け・インスタンス・移動・二重ログイン）、`Bot`
- [x] テスト：2・5・10人のボットが同じフィールドで見え合い戦う／2人で削ると2人とも経験値／チャンネル分け／本人だけのイベント／二重ログイン／移動でアイテムが増減しない／塔を2人で次の階へ
- [x] 既存のテストがすべて通る（ひとり用は `stepSolo`・`moveSolo`）

## O2：Cloudflare の土台とログイン
- [x] wrangler 設定（`server/wrangler.jsonc`）・Worker（`server/src/index.ts`）・各 Durable Object（SQLite）・D1 スキーマ（`server/migrations`）、`npm run dev:server` で workerd 上で動く
- [x] 匿名ゲストログイン（`アカウントid.秘密`、サーバーはハッシュだけ）・名前と ID の登録（D1・重複不可）・引き継ぎコード（1回だけ・前の端末は無効）
- [x] 二重ログイン防止（AccountDO が古いセッションをエリアに保存させてから切り、世代を上げる。古い世代の保存は断る）
- [x] GitHub Actions（`deploy.yml`）で Pages と Workers をデプロイ、接続先は Variables の `SERVER_URL`
- [x] docs/SETUP.md
- [x] サーバーの結合テスト：Node の中の疑似 Cloudflare（`server/test/runtime.ts`：DO・D1(node:sqlite)・WebSocket）

## O3：通信（ネットコード）
- [ ] 入力とコマンドに連番、WebSocket
- [ ] 差分スナップショット・関心範囲・送信頻度の設定
- [ ] 自分の予測と補正、他人の補間
- [ ] 自動再接続
- [ ] エリア移動（AreaDO → AccountDO → つなぎ直し）
- [ ] 遅延・パケットロスの再現

## O4：セーブの移行とオフライン版の廃止
- [ ] サーバーが正（AccountDO）。定期保存と重要な操作での保存
- [ ] 既存セーブの引き継ぎ（1回だけ・検証・削った項目の表示）
- [ ] タイトルからオフラインの導線をなくす。チュートリアルもオンラインで
- [ ] 開発用のローカル疑似サーバーモード（本番では出さない）

## O5：パーティ・チャット・救援・ビルド閲覧・ギルド
- [ ] パーティ（4人・招待・自動マッチング・募集掲示板・分配・インスタンス・レイドの人数係数）
- [ ] チャット（全体・エリア・パーティ・ギルド・個人、スタンプ・エモート、連投制限・NG・ブロック・通報）
- [ ] 救援要請
- [ ] ビルド閲覧（プロフィールカード・公開範囲）
- [ ] ギルド（作成・招待・役職・脱退・拠点の共有）

## O6：取引所と露店
- [ ] 取引所（出品・検索・購入・取り下げ・手数料・取引属性）
- [ ] 郵便受け
- [ ] 露店
- [ ] 受け渡しは AccountDO 経由。切断・失敗でも整合（テスト）

## O7：世界の共有
- [ ] 昼夜・天候をサーバー時刻で共有
- [ ] 侵攻・フィールドボスをワールド全体で共有
- [ ] タイムアタックのランキング（D1）
- [ ] ワールド通知

## O8：不正対策・運用・無料枠対策
- [ ] レート制限・速度と攻撃間隔のチェック・記録
- [ ] 管理用 API（お知らせ・停止・ログ）
- [ ] 休眠・Hibernation・設定ファイル・D1 書き込みのまとめ
- [ ] docs/COST.md（ボットで負荷を試した見積もり）
- [ ] 監視（エラー・接続数のログ）

---

## 再開メモ

- `shared/src/systems/world.ts`：`createAreaWorld`（空のエリア）・`addPlayer`/`placePlayer`・`removePlayer`・`step`。ひとり用は `createWorld`・`stepSolo`・`moveSolo`・`flushSolo`
- `step` は移動しない。`p.transition` が立ったプレイヤーは止まり、ホスト（`AreaHost.step` が返す `transfers`）が取り出して行き先へ入れる
- `shared/src/host/`：`AreaHost`（AreaDO の中身になる）・`LocalServer`・`Bot`・`audience`
- `shared/src/net/`：通信の型（`protocol.ts`）と差分スナップショット（`snapshot.ts`：`buildFrame`・`Viewer.diff`・`applySnapshot`）
- サーバー：`server/src/do/*`。DO どうしは `call(stub, op, body)`（POST /op に JSON）。テストは `server/test/client.ts` の `TestClient` と `tickAll`
- AccountDO が正。エリアは `checkout`（写しをもらう）→ `save`（世代つきで書き戻す）。チケットは HMAC 署名（`util/auth.ts`）
