# 通信の約束事

WebSocket（`/ws`）で JSON を1通ずつ送ります。すべて `type` を持ちます。
オフラインでもブラウザの中で同じメッセージをやり取りします（`client/net.js` の `LocalTransport`）。

## クライアント → サーバー

| type | 中身 | 内容 |
| --- | --- | --- |
| `hello` | `token?`, `name?` | ログイン。トークンが無効で名前もなければ `needName` が返る |
| `town:move` | `x`, `y`, `dir` | 町での位置 |
| `chat` | `text`, `party?` | チャット（80文字まで） |
| `party:create` / `party:leave` / `party:list` | | パーティの作成・離脱・一覧 |
| `party:join` | `code` | 合言葉で参加 |
| `dungeon:start` | `area` | 出発（パーティならリーダーのみ） |
| `raid:join` | | ワールドレイドに参加 |
| `input` | `mx`, `my`, `aim`, `atk`, `s1`, `s2`, `dodge`, `act`, `potion` | ダンジョンでの入力（約20回/秒） |
| `craft` | `recipe`, `ids`, `weaponType?` | 工房（`weapon` / `armor` / `acc`） |
| `equip` / `unequip` / `discard` | `id`, `slot?` | 装備の付け替え・捨てる |
| `sell` | `ids` | 素材を道具屋に売る |
| `buy` | `key`, `count?` | 回復薬（`potion`）・身代わりの護符（`charm`） |
| `market:get` / `market:list` / `market:buy` / `market:cancel` | | 取引所 |
| `codex:get` / `news:get` | | 図鑑・世界ニュース |
| `name:species` | `speciesId`, `name` | 新種の命名 |
| `eco:step` | | 生態系を進める（オフラインのみ） |

## サーバー → クライアント

| type | 内容 |
| --- | --- |
| `needName` | 名前の入力が必要 |
| `welcome` | `token`, `player`, `world`, `news`, `areas`, `offline`, `nextEcoIn` |
| `profile` | 自分の最新の情報 |
| `town:state` | 町にいる全員の位置（10回/秒） |
| `chat` / `party` / `parties` / `market` / `codex` | それぞれの最新の状態 |
| `news` | `items`（世界ニュース）, `world`（概要）, `nextEcoIn`, `stepped?` |
| `nameRight` | 新種の命名権を得た |
| `dungeon:enter` | ダンジョンに入った（`area`, `raid`） |
| `dungeon:floor` | 新しい階の地図・魔物の遺伝子・仲間の一覧 |
| `dungeon:snap` | 20回/秒の状態（下記）と自分だけの情報 `me` |
| `dungeon:end` | ランの結果（`escaped`, `floor`, `kills`, `materials`, `lost`, `gold`） |
| `toast` / `error` | 短いお知らせ・エラー |

### `dungeon:snap` の形

```
p:  [id, x, y, 向き, HP, 最大HP, フラグ, ダウン残り秒, 蘇生進み(%), 状態異常]
    フラグ: 1 ダウン / 2 回避中 / 4 攻撃中 / 8 詠唱中 / 16 階段で待機 / 32 守り / 64 疾風
m:  [id, x, y, HP, 最大HP, フラグ, 向き, 状態異常]
    フラグ: 1 被弾 / 2 凍結 / 4 墜落 / 8 攻撃中
pr: [id, x, y, 種類, 属性, 向き]
ev: イベントの配列（hit, hurt, miss, fx, kill, spawn, drop, down, revive, lost, charm, escape, floor, bossDown, wipe）
```
