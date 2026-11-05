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
- [x] 入力とコマンドに連番（`InputMsg`）、WebSocket。方向を丸めて変わったときだけ送る（`inputRate` が上限）
- [x] 差分スナップショット（変わったものだけ・見えなくなったら `gone`）・関心範囲（`interestRadius`）・送信頻度（`snapshotRate`）は `server/config.json`
- [x] 自分は先に動かす（移動と回避）→ サーバーの位置に少しずつ寄せる（大きくずれたら飛ばす）。ほかは少し前の時刻で補間
- [x] 自動再接続（再接続用チケットで同じエリアへ。猶予 `reconnectGraceSec` のあいだはキャラが残る。だめならログインからやり直して保存した場所へ）
- [x] エリア移動：AreaDO が行き先を保存（AccountDO）→ チケット → つなぎ直し。古いチケットで前のエリアに戻れない（`elsewhere`）
- [x] 遅延・取りこぼしの再現：URL に `?lag=200&loss=0.05`
- [x] テスト：連番と ack・変わらないものは送らない・関心範囲・移動でアイテムが増減しない・移動の途中で切れても大丈夫・再接続・猶予切れで保存・二重のエリア入りを断る・差分を入れ続けても写しがサーバーと同じ

## O4：セーブの移行とオフライン版の廃止
- [x] サーバーが正（AccountDO）。定期保存（`saveIntervalSec`）・エリア移動・ログアウト・切断の猶予切れ、大事な操作（精錬・生産・レベルアップ・実績・クリアなど）のあと3秒以内に保存
- [x] 既存セーブの引き継ぎ（1アカウント1回）：このブラウザの保存か書き出したファイル → `sanitizeAccount`（版の変換のあと全項目を検証：レベル・経験値・ステ/スキルの合計・装備の土台/レアリティ/数値/オプションの幅/結晶/精錬・ゴールドと素材の上限・ペット・称号・場所）→ おかしいものは削って一覧を表示。アイテム番号とキャラ id はサーバーで振り直す
- [x] タイトルはオンラインだけ（ゲスト開始・引き継ぎコード・アカウント・データ引き継ぎ）。チュートリアルはオンラインの最初のフィールド
- [x] 開発用：`npm run dev` で `?local=1`（ブラウザの中の LocalServer。本番のビルドには出さない）
- [x] テスト：検証（正しいものは通る・おかしいものだけ削る・古い版）、サーバーの引き継ぎ（1回だけ・壊れたファイル・遊んでいる間は不可・番号が重ならない）

## O5：パーティ・チャット・救援・ビルド閲覧・ギルド
- [x] パーティ（PartyDO・4人・招待・募集掲示板（WorldDO）・入口での自動マッチング（WorldDO、そろうか待ち時間で出発）・経験値は近くの仲間で分け合い人数ぶん少し増える・ドロップは仲間に順番・近くの仲間と一緒にインスタンスへ・レイドの係数は入った人数）
- [x] チャット（ChatDO：全体 `world` と個人の受け口 `user:<id>`、休止つき WebSocket。エリアはエリアの接続で。パーティ・ギルドは PartyDO / GuildDO が配る。スタンプ・エモート・連投制限・NG ワード・ブロック・通報（D1））
- [x] 救援要請（インスタンスから呼ぶ → WorldDO の一覧 → 同じインスタンスへ。クリアで助けた人にも報酬）
- [x] ビルド閲覧（プロフィールカード：ステ振り・スキル・装備・称号。公開・ギルド・非公開。D1 で検索）
- [x] ギルド（GuildDO・D1 で名前の重複を防ぐ・招待・役職（マスター/幹部/メンバー）・脱退と追放・拠点の共有）
- [x] client：チャット欄（T で入力）・メニューの「オンライン」タブ（パーティ・募集・救援・ビルド閲覧・ギルド）・入口の「マッチング」
- [x] テスト：全体/個人チャット・NG・連投・ブロック・通報・エリアの会話とエモート・パーティの招待と分配・募集・一緒にダンジョン・自動マッチング・救援と報酬・ビルドの公開範囲・ギルドの拠点と役職

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
- client：`client/src/net/`（`api.ts`・`transport.ts`・`session.ts`）。`NetSession.world` が描くための写し（`createMirrorWorld`＋`applySnapshot`）
- AccountDO が正。エリアは `checkout`（写しをもらう）→ `save`（世代つきで書き戻す）。チケットは HMAC 署名（`util/auth.ts`）
