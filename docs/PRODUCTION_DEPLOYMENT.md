# Cloudflare公開手順

この文書は、BARGAINをCloudflare Workersへ公開するための実行順です。
コード側のOpenNext/Wrangler設定はリポジトリに含まれていますが、Cloudflare
アカウント、PostgreSQL、ドメイン、秘密情報はこの環境から勝手に作成できないため、
以下の外部作業だけはアカウント所有者が実行します。

## 0. 公開判定

現在のアプリは「認証済みユーザーの交渉デモ」としては動作しますが、署名付きの
bootstrap actorはOAuth/OIDCやアカウント復旧を提供しません。無制限の一般公開を行う
前に、次のどちらかを必ず選びます。

- Cloudflare Accessでサイト自体を保護し、許可した利用者だけに公開する。
- OIDC等の実際のIdentity Providerを接続し、`ActorContext`をIdPのsubjectへ置き換える。

`BARGAIN_ENABLE_DEMO_HEADERS` は本番では常に `false` のままにしてください。本番の
セッション秘密値を設定しても、それだけで一般ユーザー向けのアカウント管理にはなりません。

## 1. ローカル前提

- Node.js 22以上
- npm
- CloudflareアカウントとWorkers利用権限
- PostgreSQL（staging用とproduction用を分ける）
- LinuxまたはWSL。OpenNextはネイティブWindowsで失敗する場合があります。

最初に依存関係と型を確認します。

```powershell
npm ci
npm run cf:typegen
npm run lint
npm run typecheck
npm test
npm run audit
npm run build
```

## 2. Cloudflareへログイン

```powershell
npx wrangler login
npx wrangler whoami
```

アカウントが複数ある場合は、対象アカウントを確認してから作業します。実行結果の
アカウントIDをリポジトリへ保存する必要はありません。

## 3. PostgreSQLとスキーマ

stagingとproductionに別のデータベースを用意します。Neon等の無料PostgreSQLでも
小規模ベータは可能ですが、スケール・バックアップ・スリープ・接続上限を確認します。

各データベースへ一度だけ次を適用します。

```powershell
psql "$env:STAGING_DATABASE_URL" -f docs/POSTGRES_SCHEMA.sql
psql "$env:PRODUCTION_DATABASE_URL" -f docs/POSTGRES_SCHEMA.sql
```

接続URLやパスワードは、チャット・Git・`.env.local`へ貼り付けないでください。既存DBに
適用する場合は、まずバックアップを取得し、テーブル変更をレビューします。

## 4. Hyperdriveを作成

Hyperdriveの接続情報はWorkerへ直接渡さず、Cloudflare側のリソースとして登録します。
stagingとproductionを分けます。次のコマンドの接続URLは、実際の値をローカル端末でだけ
指定してください。

```powershell
npx wrangler hyperdrive create bargain-staging --connection-string="$env:STAGING_DATABASE_URL"
npx wrangler hyperdrive create bargain-production --connection-string="$env:PRODUCTION_DATABASE_URL"
```

出力された2つのIDを、`wrangler.jsonc` の以下へ置き換えます。

- `REPLACE_WITH_STAGING_HYPERDRIVE_ID`
- `REPLACE_WITH_PRODUCTION_HYPERDRIVE_ID`

IDを置き換えたあと、型を更新します。

```powershell
npm run cf:typegen
```

本番のPersistenceはHyperdrive bindingを優先し、Workerインスタンス内のMapへは
フォールバックしません。通常のNode実行時だけ `DATABASE_URL`等を使用します。

## 5. Worker用の秘密情報

環境ごとに、別々の値を登録します。各コマンドは入力待ちになり、値は画面へ表示
されません。最低32文字のランダム値を使い、2つの暗号秘密値を同じ値にしないでください。

```powershell
npx wrangler secret put BARGAIN_PRIVATE_STATE_KEY --env staging
npx wrangler secret put BARGAIN_SESSION_SECRET --env staging
npx wrangler secret put BARGAIN_OPERATOR_TOKEN --env staging

npx wrangler secret put BARGAIN_PRIVATE_STATE_KEY --env production
npx wrangler secret put BARGAIN_SESSION_SECRET --env production
npx wrangler secret put BARGAIN_OPERATOR_TOKEN --env production
```

LLMを使う場合だけ、選択したプロバイダーのキーを登録します。キーなしでも決定論的な
フォールバック戦略で動作します。

```powershell
npx wrangler secret put GOOGLE_API_KEY --env production
# または
npx wrangler secret put OPENAI_API_KEY --env production
```

`DATABASE_URL`はCloudflare本番では通常不要です。Hyperdriveの接続先を変更する場合は、
接続情報をWorker secretではなくHyperdrive設定として更新します。

## 6. 本番以外の設定

LLMモデルやプロバイダーを固定する場合は、Cloudflare DashboardのWorker Variables
（非秘密）またはWranglerのenvironment varsで設定します。

- `BARGAIN_LLM_PROVIDER`: `auto` / `google` / `openai`
- `BARGAIN_GOOGLE_MODEL`
- `BARGAIN_OPENAI_MODEL`
- `BARGAIN_ENABLE_DEMO_HEADERS`: 常に `false`

本番で `BARGAIN_ENABLE_DEMO_HEADERS=true` を設定しないでください。`wrangler.jsonc`にも
本番・stagingの明示的な `false` を入れています。

## 7. Workerをビルドして確認

WindowsでNext.jsの `npm run build` が通っても、OpenNextのWorker bundlingはWSL/Linuxで
確認します。

```powershell
npm run cf:dry-run
```

このコマンドはOpenNext bundleを作り、staging environmentでWranglerのdry-runを行います。
dry-runはplaceholderのIDを構文上受け入れる場合があるため、実デプロイ前に必ず実際の
Hyperdrive IDへ置き換え、stagingの `/api/health` でDB接続を確認してください。

ローカルWorkerの挙動を見る場合は、`.dev.vars`を作成してから実行します。

```powershell
Copy-Item .dev.vars.example .dev.vars
npm run preview
```

`.dev.vars`には実際のキーを保存できますが、Gitへ追加しないでください。production用の
値をlocal previewへコピーしないでください。

## 8. stagingへデプロイ

```powershell
npm run deploy:staging
```

確認項目:

- `https://<worker>.workers.dev` または設定したstaging hostnameでトップ画面が開く。
- 初回セッション作成、再読み込み、交渉step、pause/resume、rejectが動く。
- 交渉IDをlocalStorageに残したまま再読み込みしても取得できる。
- approval、contract draft、イベントログがPostgreSQLに残る。
- 別ブラウザまたは別Workerリクエストから同じセッションを確認できる。
- LLMキーを設定した場合、キー未設定・プロバイダー障害時のfallbackも確認する。
- `GET /api/negotiations/:id/events` のSSEが接続後に切断・再接続できる。
- `GET /api/health` が200を返し、`database` が `postgresql` になっている。

## 9. 本番前のブラウザ・DBテスト

stagingで次を実データベースに対して行います。

1. 新規セッションを作成する。
2. ページを再読み込みし、同じactorでセッションを取得する。
3. 2つのタブから同時に同じ操作を送り、version conflictで片方が拒否される。
4. 同じidempotency keyを再送し、二重イベント・二重承認が作られない。
5. 承認をapprove/rejectし、期限切れ・再送・stale subjectを確認する。
6. Workerを複数インスタンス相当で叩き、DBが唯一の状態源になっていることを確認する。
7. DB障害時に500ではなく安全なエラーになり、private stateがレスポンスへ出ないことを確認する。

## 10. 認証・公開境界

本番公開前に、認証方式を実装・確認します。少人数の社内ベータならCloudflare Accessで
サイトを保護する方法が最短です。一般公開サービスにするなら、IdPのsubject、role、
logout、アカウント復旧、ユーザー削除、監査ログを実装し、`src/lib/auth/actor.ts`の
bootstrap actorを置き換えます。

operator用エンドポイントは一般ユーザーへ公開せず、Cloudflare Access、別の管理URL、
または強いIdP role claimで保護します。`BARGAIN_OPERATOR_TOKEN`をブラウザへ埋め込んだり、
公開リポジトリへ書いたりしないでください。

## 11. レート制限・監視・バックアップ

- LLMを呼ぶAPIへCloudflare WAF/Rate Limitingを設定する。
- 少なくともセッション作成、action実行、SSE接続、デモAPIへ上限を設定する。
- Cloudflare Workers Logsを有効にし、エラー率・CPU時間・リクエスト数を監視する。
- PostgreSQLの自動バックアップ、保持期間、復旧テストを設定する。
- APIキーの利用量と上限をプロバイダー側で設定する。
- アプリのエラー監視（Sentry等）は必要に応じて追加する。
- Cloudflareの無料ログ保持期間とDBの無料枠を、利用者数に対して毎月確認する。

アプリ内のMapはlocal開発用です。Workersのグローバル変数を分散ロックや永続DBの代わりに
使わないでください。現在のSSEはDBを2秒間隔でpollします。接続数が増える場合は、まず
SSE接続数とHyperdriveクエリ数を測定し、必要ならDurable Objects等へ設計を拡張します。

## 12. ドメインと公開

stagingで問題がなければ、Cloudflare DashboardでカスタムドメインをWorkerへ割り当て、
TLS、Access、WAF、robots、利用規約・プライバシーポリシーを確認します。料金が発生する
機能や独自ドメインのレジストラ費用は、Workers無料枠とは別です。

```powershell
npm run deploy:production
```

デプロイ後は次を保存します。

- production Worker名とURL
- デプロイ日時・バージョン
- Hyperdrive ID
- schema migrationのバージョン
- 監視ダッシュボードURL
- rollback担当者と手順

## 13. 無料枠での判定

小規模な招待制ベータなら、Cloudflare Workersの無料枠と無料PostgreSQLで開始できます。
ただし、無料枠で「無制限に公開できる」という意味ではありません。

- Workers Freeは日次リクエスト数、CPU時間、Worker scriptのgzipサイズに上限がある。
- Hyperdriveの無料クエリ数にも上限がある。
- このアプリのSSEは接続中に2秒間隔でDBをpollするため、接続数が増えるとHyperdriveの
  クエリ枠を先に消費する可能性がある。
- LLM API、独自ドメイン、メール、監視、バックアップは別料金または別サービスの枠を使う。

公開前と月次で、Wranglerのdry-runに表示されるgzipサイズ、Workers requests、CPU、
Hyperdrive queries、LLM利用量を確認します。上限に近づいたら、SSEの接続数を制限する、
polling間隔を見直す、LLMをfallbackへ切り替える、Workers Paidへ移行する、の順で対応します。

最新の上限は[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)、
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)、
[Hyperdrive pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)を確認してください。

## 14. ロールバック

アプリのロールバックは、まず直前のWorker versionへ戻します。DB schemaを後方互換なしに
変更しないことが重要です。障害時は、LLMキーを無効化してfallbackへ切り替える、WAFで
新規actionを一時制限する、DBをread-only相当にする、の順で影響を止めます。

## 関連ファイル

- `wrangler.jsonc`: Worker、environment、Hyperdrive、observability設定
- `open-next.config.ts`: OpenNext Cloudflare adapter設定
- `.dev.vars.example`: local Worker preview用の例
- `docs/POSTGRES_SCHEMA.sql`: PostgreSQL初期スキーマ
- `src/lib/negotiation/persistence.ts`: Hyperdrive/Node PostgreSQL adapter
- `src/app/api/health/route.ts`: DB接続を含むWorkerヘルスチェック
