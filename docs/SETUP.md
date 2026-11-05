# サーバーの準備（人がやること）

オンライン版は **Cloudflare Workers ＋ Durable Objects ＋ D1** で動きます。
コードと GitHub Actions はできているので、ここにある「アカウントと鍵の準備」だけを人がやります。
準備ができるまでは、ローカル（`npm run dev:server`）で動かせます。

## 1. Cloudflare のアカウントを作る

1. https://dash.cloudflare.com/sign-up で無料のアカウントを作る（Workers の無料プランで足ります）
2. ダッシュボードの右側（または Workers & Pages の概要）にある **アカウント ID** を控える
3. Workers & Pages を一度開き、`<サブドメイン>.workers.dev` のサブドメインを決める

## 2. API トークンを作る

1. ダッシュボード右上の人のアイコン → **My Profile** → **API Tokens** → **Create Token**
2. テンプレート **Edit Cloudflare Workers** を選ぶ
3. 権限に **Account → D1 → Edit** を足す
4. 「Account Resources」を自分のアカウントにして作成し、表示されたトークンを控える（1回しか表示されません）

## 3. D1 のデータベースを作る

手元の PC で（Node.js 22 以上）：

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npx wrangler d1 create endless-garden
```

表示された `database_id`（`xxxxxxxx-xxxx-...`）を控える。
`server/wrangler.jsonc` の `database_id` は書き換えなくてかまいません（デプロイのときに GitHub Actions が Secrets の値で置き換えます）。

## 4. 秘密の値を決める

- **SESSION_SECRET**：チケットの署名に使う長いランダムな文字列（例：`openssl rand -base64 48` の結果）
- **ADMIN_TOKEN**：管理用 API に使う長いランダムな文字列（お知らせ・停止・ログの確認）

## 5. GitHub に登録する

リポジトリの **Settings → Secrets and variables → Actions**

**Secrets**（New repository secret）

| 名前 | 値 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 2 のトークン |
| `CLOUDFLARE_ACCOUNT_ID` | 1 のアカウント ID |
| `D1_DATABASE_ID` | 3 の database_id |
| `SESSION_SECRET` | 4 の値 |
| `ADMIN_TOKEN` | 4 の値 |

**Variables**（Variables タブ → New repository variable）

| 名前 | 値 |
| --- | --- |
| `SERVER_URL` | `https://endless-garden.<サブドメイン>.workers.dev` |

## 6. デプロイ

`main` に push するか、Actions の **deploy** を手で実行します。
テスト → D1 のマイグレーション → Workers のデプロイ → 秘密の値の登録 → GitHub Pages のビルド（`SERVER_URL` に接続）の順に動きます。
Secrets がないあいだは、サーバーのデプロイだけ飛ばされます（フロントは公開されますが、つながりません）。

うまくいったか：`https://endless-garden.<サブドメイン>.workers.dev/api/health` が `{"ok":true,...}` を返せば成功です。

## ローカルで動かす（準備なしで）

```bash
npm install
```

```bash
cp server/.dev.vars.example server/.dev.vars
```

```bash
npm run db:migrate:local
```

```bash
npm run dev:server
```

別のターミナルで：

```bash
npm run dev
```

ブラウザで http://localhost:5173 を開くと、`http://localhost:8787` のサーバーにつながります（`VITE_SERVER_URL` を指定しなければローカルにつなぐ）。

遅延を入れて試すときは URL に `?lag=200&loss=0.05`（200ms の遅延と 5% の取りこぼし）を付けます。
サーバーなしでひとりで動かすとき（開発用）は `?local=1`。

## 設定を変える（有料プランに移るときなど）

`server/config.json` が既定値です。tick の頻度・スナップショットの頻度・チャンネルの人数・関心範囲などがあります。
Cloudflare の環境変数 `CONFIG` に JSON を入れると上書きできます（例：`{"snapshotRate":20,"channelCap":60}`）。
