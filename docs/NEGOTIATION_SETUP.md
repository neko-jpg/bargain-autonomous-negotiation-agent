# 実API交渉の起動と永続化

## 画面から開始

マーケット画面の「実APIで交渉開始」またはナビゲーションの「実API交渉」を押すと、次の順で実行されます。

1. `POST /api/negotiations` でセッションを作成
2. `POST /api/negotiations/:id/actions` に `auto_step` を送信
3. LangGraph の `observe → assess → plan → guardrail → act` を1ターン実行
4. API応答のセッションをライブ交渉画面へ反映

`accept_offer` は合意を作るだけで、購入は実行しません。セッションは `awaiting_commit`（購入確定の承認待ち）になり、合意内容（価格・条件・当事者）のハッシュが記録されます。

- 自動購入がオンで、総額が自動承認上限以内なら、ポリシーの事前承認として Commit Gate が購入を1回だけ実行します。
- それ以外は、ライブ画面の「この内容で購入を確定」またはダッシュボードの承認キューで、本人が署名付きの承認を行うまで実行されません。「購入を見送る」を選ぶと交渉は一時停止に戻り、終了はしません。
- 安全停止（kill switch）中は、自動交渉と購入確定がどちらも保留されます。

詳細は [SAFETY_CASE.md](SAFETY_CASE.md) を参照してください。

## PostgreSQLを有効にする

1. `docs/POSTGRES_SCHEMA.sql` を対象DBへ適用します。
2. `.env.local` に `DATABASE_URL` と `BARGAIN_PRIVATE_STATE_KEY` を設定します。
3. 開発サーバーを再起動します。

`BARGAIN_PRIVATE_STATE_KEY` は64桁hex、または十分に長いランダム文字列を使用してください。買い手・売り手の非公開状態はAES-256-GCMで暗号化して保存します。

`DATABASE_URL` が未設定の場合は、開発用のインメモリストアへフォールバックします。既存DBへ適用する場合は、既存スキーマの型変更・列追加を確認してからマイグレーションとして適用してください。

## 評価

```bash
npm test
npm run safety:verify
```

価格上限、最低利益、納期、税込・税別、送料込み予算、相手メッセージのインジェクション、合意なし終了をAPIコストなしで検証します。`npm run safety:verify` は、攻撃23件（メモリ／PostgreSQL）、ファズ、深さ3の総当たり探索、ミューテーションテストを実行します。結果は [safety/RESULTS.md](safety/RESULTS.md) にまとめています。
