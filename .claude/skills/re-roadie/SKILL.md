---
name: re-roadie
description: re:Invent の参加者の意図をもとに、session-roadie MCPサーバー（auth_status/catalog_sync/schedule_get/schedule_plan/schedule_apply/conflicts_get/travel_blocks_plan/travel_blocks_apply/notes_*/onboarding_save）を使ってセッション計画・予約・移動時間確保・メモ反映を行う手順。「re:Invent の予定を整えて」「今日の予定を組んで」「移動時間を確保して」「メモをリマインダーにして」のような依頼があったときに使う。
---

# re:Roadie の使い方

このスキルは**手順だけ**を定義する。実際のロジック（差分計算・冪等な再照合・移動時間計算・クォータ制御・代替判定）はすべて `session-roadie` MCPサーバー側にある。このスキルはそれをどの順番で呼ぶかだけを決める。

## 大原則

- **書き込み系は必ず `*_plan` で差分を見せてから `*_apply` で実行する。** `schedule_apply`/`travel_blocks_apply`/`notes_reminders_apply` はMCPツールとして呼ばれたら確認なしでそのまま実行されるので、**ユーザーへの確認はこのスキル（Claude）が担う**。
- 存在しないセッションIDを `reserve`/`favorite` に入れない。カタログに実在するIDか、`catalog_sync` の結果または `data/catalog-<eventId>.json` のスナップショットで確認してから使う。
- `ReserveSessions`/`CancelReservation`（予約の作成・取消）は2026-10-08のAPI開放待ちで、それまでは `403`/`409` になる可能性がある。失敗したら「予約APIがまだ開放されていない」可能性を案内する。

## サインイン確認

何かする前に `auth_status` を呼ぶ。`signedIn: false` なら `auth_login` を呼ぶ（ブラウザが開くので、ユーザーに「ブラウザでBuilder IDにサインインしてください」と伝えて完了を待つ）。

## 初めての参加者

意図やプロフィールが無い状態で「どう過ごせばいいか分からない」と言われたら、`onboarding_save` を使う。ユーザーに3つ質問する。

1. 普段の仕事は？ → `infrastructure`/`appDev`/`data`/`management`
2. 今回の一番の目的は？ → `learning`/`research`/`networking`/`report`
3. 体力に自信は？ → `packed`/`normal`/`relaxed`

回答を `onboarding_save` に渡すと、`data/profile.yaml` と `data/intent.txt` が作られる。

## 「今日の予定を組んで」「セッションを予約して」

1. `catalog_sync` でカタログの差分を取り、新着・変更・キャンセルがあればユーザーに伝える。
2. ユーザーの意図（自由文、または `data/intent.txt`）とカタログを突き合わせ、具体的な `reserve`（予約したいセッションID）・`favorite`（お気に入りにしたいセッションID）の配列を組み立てる。**この「意図の解釈」はこのスキル（Claude）の仕事**で、session-roadie側にはない。
3. `schedule_plan` でその配列と実スケジュールとの差分を取得する。
4. 差分をユーザーに見せ、実行してよいか確認する。
5. 確認が取れたら `schedule_apply` を呼ぶ。結果の `result.reserve.failed`/`result.favorite.failed` を必ず確認し、失敗があれば `code`（`scheduleConflict`/`sessionFull`等）と一緒に伝える。`remainingPlan` に差分が残っていれば「一部反映されていない」とユーザーに伝える。

## 「競合を解消したい」「どれを諦めればいい？」

`conflicts_get` を呼ぶ。各競合グループの `recommended`（推奨セッションID）と `reasons`（再演や類似セッションの有無という事実に基づく理由）をそのままユーザーに見せる。Claude自身の主観で推奨を変えない。

## 「移動時間を確保して」

1. `travel_blocks_plan` を呼ぶ。
2. `insufficientBlocks`（移動が間に合わないペア）があれば警告として伝える。
3. `candidates`（新規に確保できるブロック）をユーザーに見せ、確認を取る。
4. 確認が取れたら `travel_blocks_apply` を呼ぶ。
5. **公式アプリへの反映には数分〜十数分のラグがある**（実機確認済み）。「すぐ反映されないことがある」とユーザーに伝えておく。

## 「メモを残して」「当日リマインダーにして」

- メモを残すだけなら `notes_add`（`sessionId` と自由文の `text`）。
- 「当日リマインダーとして公式アプリに反映して」と言われたら、`notes_reminders_plan` → 確認 → `notes_reminders_apply` の順（書き込み系なので上記の大原則に従う）。

## 「帰国後の報告を作って」

`notes_report` を呼ぶ。テーマ別に整理されたMarkdownがそのまま返るので、必要なら体裁を整えてユーザーに渡す。
