# Night Shift

**夜の間に、明日の予定を整えておくエージェント。あなたは公式アプリを開くだけでいい。**

re:Invent 参加者の意図とプロフィールをもとに、[AWS Events API](https://docs.aws.amazon.com/events/latest/devguide/what-is-events-api.html) でセッションの計画・予約・移動時間確保・変更追従を行い、結果を**公式アプリの個人スケジュールに書き戻す**ローカルCLIエージェントです。

自作のUIは持ちません。会場では公式アプリを見るだけで済むようにする、という発想が中核です（詳細は `docs/superpowers/plans/2026-09-27-night-shift-implementation.md` と企画書を参照）。

## このツールが守っていること

2023年10月、AWSは第三者製のセッショントラッカーにテイクダウン通知を送付しました。理由は非公開APIの無許可利用とカタログデータの再配布です。今回のAPI開放はその経緯を踏まえた公式な和解でもあります。本ツールは次を守ります。

- **クォータを厳守する**：`ListSessions`/`GetSession` 120回/分、`GetSchedule` 60回/分、書き込み系30回/分（[src/api/quotas.ts](src/api/quotas.ts)）。`429` は `Retry-After` に従ってリトライします。
- **カタログデータを再配布しない**：取得したセッション情報はローカルの `data/` 配下にのみ保存し、リポジトリにコミットしません（`.gitignore` 参照）。
- **個人情報はローカル保存のみ**：プロフィール・意図・メモはAPIに送信せず、ローカルファイルにのみ保存します。
- **ホスティングしない**：全機能は利用者自身のマシン上で、利用者自身としてサインインして動作します。

## 必要環境

- Node.js 22 以上

## セットアップ

```bash
npm install
npm run build
```

## 使い方

初回は対話ウィザードで簡単なプロフィールと意図を作成します（YAMLを直接書く必要はありません）。

```bash
node dist/cli.js init
```

### 代表的なコマンド

| コマンド | 内容 |
| --- | --- |
| `night-shift sync` | カタログを全件取得し、前回のローカルスナップショットとの差分（新規・変更・キャンセル）を表示する |
| `night-shift schedule` | 現在のスケジュール（予約・お気に入り・個人予定）を表示する |
| `night-shift apply <desiredStateFile>` | あるべき状態（予約・お気に入りにしたいセッションID）を実スケジュールと突き合わせ、差分だけ実行する。実行前に操作内容を表示して確認を取り、実行後は必ず `GetSchedule` で再照合する |
| `night-shift conflicts` | 予約済みセッションの時間重複を検出し、再演・類似セッションの有無という事実ベースの根拠つきで「諦めてよいもの」を提案する |
| `night-shift travel-blocks` | 予約済みセッション間の移動時間を計算し、間に合わない場合は警告、間に合う場合は `CreatePersonalTime` で移動時間を公式スケジュールに書き込む |
| `night-shift notes add/list/report/apply` | セッションへのメモの記録・一覧・テーマ別の帰国後報告・当日リマインダーの書き込み |
| `night-shift auth status` | サインイン状態を表示する |

`apply`/`travel-blocks`/`notes apply` は実行前に確認プロンプトを出します。自動実行したい場合は `-y`/`--yes` を付けてください。

### `apply` に渡す「あるべき状態」ファイルの例

```json
{
  "reserve": ["SVS401", "BOA315"],
  "favorite": ["CMP318"]
}
```

このファイルに何を入れるか（＝自由文の意図をどのセッションIDに変換するか）は、本ツールの外側（対話的なエージェントや利用者自身の判断）が担います。night-shift は「決まった、あるべき状態」を安全かつ冪等に実行する部分を受け持ちます。

## 現状の制約

- **Builder ID のサインインフロー本体は未実装**です（[src/auth/tokenStore.ts](src/auth/tokenStore.ts) はトークンの保存・読み込みのみ）。認可サーバーのエンドポイント（authorize/token URL）が実データ未確認のため、`node dist/cli.js auth status` は常に「未サインイン」と表示されます。サインインが必要なAPI呼び出しは401になります。
- **`ReserveSessions`/`CancelReservation` は未検証**です。2026-10-08の予約API開放前のため、モックテストのみで実レスポンスでの確認ができていません。
- **会場間の移動時間テーブル（[src/schedule/travelTime.ts](src/schedule/travelTime.ts)）は実測値ではありません**。企画書の「20〜40分」という大まかな記述を根拠にした仮の概算値です。
- **PersonalTimeの日時はPST固定（UTC-8）で計算**しています。re:Invent会期（2026年12月上旬）はサマータイムの影響を受けない前提です。

## テスト

```bash
npm test
```

## アーキテクチャ概要

```
src/
  api/        AWS Events APIの型定義・クォータ管理・HTTPクライアント
  auth/       Builder IDトークンのローカル保存
  profile/    プロフィール・意図・メモのローカルストア
  catalog/    セッション全件取得・スナップショット保存・差分検知
  schedule/   再照合ロジック・書き込みラッパー・移動時間ブロック
  planning/   代替判定（再演・類似セッション）
  reporting/  帰国後報告の生成
  onboarding/ 初参加者向け対話ウィザードのロジック
  commands/   CLIコマンドの実処理（テスト可能な純粋関数として分離）
  cli.ts      commanderによるCLIエントリポイント
```

## まだ終えていないこと

- デモ動画の撮影（「予定が壊れて自動で直る」様子を30秒で示す）
- Builder Center プロジェクトとしての提出
- 応募資格・除外規定の確認

これらは人間の判断・操作が必要なため、本READMEの対象外です。
