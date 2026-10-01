# Session Roadie（愛称: re:Roadie）

**会場の裏方として、あなたの代わりに公式アプリを整え続けるエージェント。あなたは公式アプリを開くだけでいい。**

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

初回は対話ウィザードで簡単なプロフィールと意図を作成し、Builder IDでサインインします（YAMLを直接書く必要はありません）。

```bash
node dist/cli.js init
node dist/cli.js auth login
```

`auth login` はブラウザを開いて Builder ID のサインイン画面に遷移します。サインイン後、ブラウザは `http://localhost:8484`〜`8489` のいずれかに戻ります（ローカルで待ち受けるだけで、外部に公開されるポートではありません）。

### 代表的なコマンド

| コマンド | 内容 |
| --- | --- |
| `re-roadie sync` | カタログを全件取得し、前回のローカルスナップショットとの差分（新規・変更・キャンセル）を表示する |
| `re-roadie schedule` | 現在のスケジュール（予約・お気に入り・個人予定）を表示する |
| `re-roadie apply <desiredStateFile>` | あるべき状態（予約・お気に入りにしたいセッションID）を実スケジュールと突き合わせ、差分だけ実行する。実行前に操作内容を表示して確認を取り、実行後は必ず `GetSchedule` で再照合する |
| `re-roadie conflicts` | 予約済みセッションの時間重複を検出し、再演・類似セッションの有無という事実ベースの根拠つきで「諦めてよいもの」を提案する |
| `re-roadie travel-blocks` | 予約済みセッション間の移動時間を計算し、間に合わない場合は警告、間に合う場合は `CreatePersonalTime` で移動時間を公式スケジュールに書き込む |
| `re-roadie notes add/list/report/apply` | セッションへのメモの記録・一覧・テーマ別の帰国後報告・当日リマインダーの書き込み |
| `re-roadie auth login` | ブラウザでBuilder IDにサインインする |
| `re-roadie auth status` | サインイン状態を表示する |
| `re-roadie auth logout` | サインアウトする（refresh tokenを失効させ、ローカルのトークンを削除し、Builder IDのブラウザセッションも終了する） |

ビルド前に試す場合は `node dist/cli.js <サブコマンド>` のように読み替えてください。

`apply`/`travel-blocks`/`notes apply` は実行前に確認プロンプトを出します。自動実行したい場合は `-y`/`--yes` を付けてください。

### `apply` に渡す「あるべき状態」ファイルの例

```json
{
  "reserve": ["SVS401", "BOA315"],
  "favorite": ["CMP318"]
}
```

このファイルに何を入れるか（＝自由文の意図をどのセッションIDに変換するか）は、本ツールの外側（対話的なエージェントや利用者自身の判断）が担います。Session Roadie は「決まった、あるべき状態」を安全かつ冪等に実行する部分を受け持ちます。

### Claude Code から使う（MCPサーバー）

CLIに加えて、`re-roadie mcp` でMCPサーバー（stdio）としても起動できます。Claude Codeで本プロジェクトを開くと、`.mcp.json` に登録済みの `session-roadie` サーバーと、`.claude/skills/re-roadie/SKILL.md`（MCPツールをどの順番で呼ぶかという手順書）が自動的に使えます。

```
Claude Code → スキル/コマンド（手順だけ） → re:Roadie（ロジックは全部ここ） → AWS Events REST API
```

- ロジック（差分計算・冪等な再照合・移動時間計算・クォータ制御・代替判定）はすべて re:Roadie 側にあり、スキルは「どの順番で呼ぶか」だけを定義します。
- 書き込み系ツール（`schedule_apply`/`travel_blocks_apply`/`notes_reminders_apply`）は確認プロンプトを持たず、呼ばれたら即実行します。確認は `*_plan` ツールで事前に差分を見せたうえで、呼び出し側（スキル経由のClaude）が担います。
- 公開しているツールは [src/mcp/server.ts](src/mcp/server.ts) を参照してください（`auth_*`/`catalog_sync`/`schedule_*`/`conflicts_get`/`travel_blocks_*`/`notes_*`/`onboarding_save` の16個）。

## 現状の制約

- **`ReserveSessions`/`CancelReservation` は未検証**です。2026-10-08の予約API開放前のため、モックテストのみで実レスポンスでの確認ができていません。
- **会場間の移動時間テーブル（[src/schedule/travelTime.ts](src/schedule/travelTime.ts)）は実測値ではありません**。企画書の「20〜40分」という大まかな記述を根拠にした仮の概算値です。
- **PersonalTimeの日時はPST固定（UTC-8）で計算**しています。`GetEvent`の実データ（`startDate`/`endDate`のISO8601オフセット）で裏付け済みです。
- **`CreatePersonalTime`で書き込んだ内容が公式アプリ（スマートフォン）のカレンダーに反映されるまで、数分〜十数分のラグがあります**（2026-10-01実機確認）。サーバー側のデータ（`GetSchedule`で取得できる内容）は即座に正しく更新されますが、アプリのクライアント側キャッシュへの反映はすぐではありません。「予定が自動で直る」デモを撮る際はこの遅延を考慮してください。

## テスト

```bash
npm test
```

## アーキテクチャ概要

```
src/
  api/        AWS Events APIの型定義・クォータ管理・HTTPクライアント
  auth/       Builder ID OAuth(PKCE)サインイン・トークンの自動更新とローカル保存
  profile/    プロフィール・意図・メモのローカルストア
  catalog/    セッション全件取得・スナップショット保存・差分検知
  schedule/   再照合ロジック・書き込みラッパー・移動時間ブロック
  planning/   代替判定（再演・類似セッション）
  reporting/  帰国後報告の生成
  onboarding/ 初参加者向け対話ウィザードのロジック
  commands/   CLI/MCP共通の実処理（テスト可能な純粋関数として分離）
  mcp/        MCPサーバー（tools.tsがハンドラ、server.tsがMcpServerへの登録）
  runtimeContext.ts  CLI/MCP共通の設定（データディレクトリ、ApiClient生成）
  cli.ts      commanderによるCLIエントリポイント（実行コマンド名: `re-roadie`。`re-roadie mcp` でMCPサーバーとして起動）
```

## まだ終えていないこと

- デモ動画の撮影（「予定が壊れて自動で直る」様子を30秒で示す）
- Builder Center プロジェクトとしての提出
- 応募資格・除外規定の確認

これらは人間の判断・操作が必要なため、本READMEの対象外です。
