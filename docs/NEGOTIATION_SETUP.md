# 実API交渉の起動と永続化

## 画面から開始

マーケット画面の「実APIで交渉開始」またはナビゲーションの「実API交渉」を押すと、次の順で実行されます。

1. `POST /api/negotiations` でセッションを作成
2. `POST /api/negotiations/:id/actions` に `auto_step` を送信
3. LangGraph の `observe → assess → plan → guardrail → act` を1ターン実行
4. API応答のセッションをライブ交渉画面へ反映

`accept_offer` が自動承認条件を満たさない場合は `paused_for_human` になり、「この条件で承認」ボタンが表示されます。

## PostgreSQLを有効にする

1. `docs/POSTGRES_SCHEMA.sql` を対象DBへ適用します。
2. `.env.local` に `DATABASE_URL` と `BARGAIN_PRIVATE_STATE_KEY` を設定します。
3. 開発サーバーを再起動します。

`BARGAIN_PRIVATE_STATE_KEY` は64桁hex、または十分に長いランダム文字列を使用してください。買い手・売り手の非公開状態はAES-256-GCMで暗号化して保存します。

`DATABASE_URL` が未設定の場合は、開発用のインメモリストアへフォールバックします。既存DBへ適用する場合は、既存スキーマの型変更・列追加を確認してからマイグレーションとして適用してください。

## 評価

```powershell
npm test
```

価格上限、最低利益、納期、税込・税別、送料込み予算、相手メッセージのインジェクション、合意なし終了をAPIコストなしで検証します。評価結果には制約違反率、成約率、平均値引き率、平均交渉回数、APIコスト、フォールバック率を含めています。
