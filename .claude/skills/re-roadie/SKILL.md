---
name: re-roadie
description: re:Invent の参加者の意図をもとに、session-roadie MCPサーバー（auth_status/catalog_sync/catalog_search/profile_get/schedule_optimize/schedule_get/schedule_plan/schedule_apply/conflicts_get/travel_blocks_plan/travel_blocks_apply/notes_*/onboarding_save）を使ってセッション計画・予約・移動時間確保・メモ反映を行う手順。「re:Invent の予定を整えて」「今日の予定を組んで」「移動時間を確保して」「メモをリマインダーにして」のような依頼があったときに使う。
---

# re:Roadie の使い方

このスキルは**手順だけ**を定義する。実際のロジック（差分計算・冪等な再照合・移動時間計算・クォータ制御・代替判定）はすべて `session-roadie` MCPサーバー側にある。このスキルはそれをどの順番で呼ぶかだけを決める。

## 大原則

- **書き込み系は必ず `*_plan` で差分を見せてから `*_apply` で実行する。** `schedule_apply`/`travel_blocks_apply`/`notes_reminders_apply` はMCPツールとして呼ばれたら確認なしでそのまま実行されるので、**ユーザーへの確認はこのスキル（Claude）が担う**。
- `schedule_plan`/`schedule_apply` の `reserve`/`favorite` は「あるべき状態の全体」。**変えたくない側は省略する**（省略＝現状維持）。`[]` を渡すと全取消・全解除になる。
- 存在しないセッションIDを `reserve`/`favorite` に入れない。カタログに実在するIDか、`catalog_sync` の結果または `data/catalog-<eventId>.json` のスナップショットで確認してから使う。
- `ReserveSessions`/`CancelReservation`（予約の作成・取消）は2026-10-08のAPI開放待ちで、それまでは `403`/`409` になる可能性がある。失敗したら「予約APIがまだ開放されていない」可能性を案内する。
- カタログのセッション情報（タイトル・abstract等）は英語のみ。ユーザーにセッション情報を提示するとき（予定一覧・競合の提案・メモのリマインダーなど）は、英語タイトルに加えて日本語訳・簡潔な説明を併記する。

## サインイン確認

何かする前に `auth_status` を呼ぶ。アクセストークン（約1時間）が切れていても refresh token で自動更新できれば `signedIn: true`（`refreshed: true`）が返るので、再ログインは不要。`signedIn: false` のときだけ `auth_login` を呼ぶ（ブラウザが開くので、ユーザーに「ブラウザでBuilder IDにサインインしてください」と伝えて完了を待つ）。

## 初めての参加者

意図やプロフィールが無い状態で「どう過ごせばいいか分からない」と言われたら、`onboarding_save` を使う。ユーザーに5つ質問する（4・5は任意。「未定」「特になし」でよい）。

1. 普段の仕事は？ → `infrastructure`/`appDev`/`data`/`management`
2. 今回の一番の目的は？ → `learning`/`research`/`networking`/`report`
3. 体力に自信は？ → `packed`/`normal`/`relaxed`
4. 参加できる日は？ → `firstDay`/`lastDay`（`2026-11-30`〜`2026-12-04`）
5. 関心のあるテーマは？（複数可） → `agenticAI`/`security`/`data`/`appDev`/`infrastructure`/`migration`

回答を `onboarding_save` に渡すと、`data/profile.yaml` と `data/intent.txt` が作られる。保存した回答は以降の `schedule_optimize`/`catalog_search` に既定値として自動で効く（体力→1日の上限本数・最低空き時間、目的→優先する形式、参加日→対象日）。結果の `optimizeDefaults` をユーザーに見せ、「この条件で組みます」と伝える。

## 「今日の予定を組んで」「セッションを予約して」

1. `catalog_sync` でカタログの差分を取り、新着・変更・キャンセルがあればユーザーに伝える。
2. `profile_get` でプロフィールと意図を読む。`profile` が `null` なら、上の「初めての参加者」の質問を提案する（断られたら、その場の自由文の意図だけで進める）。`interestTopics` があれば `catalog_search` の `topics` に使う。
3. ユーザーの意図（その場の自由文と `intent`）を検索条件に変換し、`catalog_search` で候補を絞る。**この「意図の解釈」はこのスキル（Claude）の仕事**で、session-roadie側にはない。"agent" のような頻出語は abstract まで含めると半数以上に当たるので、`keywordScope: "title"` やトピック・形式・日付で絞る。既存のお気に入り（`schedule_get`）も候補の材料にする。参加日がプロフィールにあれば `dates` は自動で絞られる（`appliedProfileDefaults`）。
4. 候補IDを `schedule_optimize` に渡す。再演（-R/-R1…）への差し替え・個人予定（基調講演など）・会場間の移動時間・プロフィール（1日の上限本数・最低空き時間・優先形式・参加日）を考慮した、重ならない最大の組み合わせ（`reserve`）が返る。適用した条件は `appliedOptions` で返るので、ユーザーに伝える。その場で「今日は詰め込みたい」などと言われたら、`maxSessionsPerDay` 等を引数で上書きする。`dropped`（入らなかった候補と衝突相手。`dailyLimit`＝上限本数、`outsideAttendance`＝参加日外）と `substitutedFor`（差し替えた回）もユーザーに伝える。`optimal: false` なら探索上限で打ち切った近似解であることも伝える。
5. `schedule_plan` に `reserve` を渡して差分を取得する（お気に入りを変えないなら `favorite` は省略する）。
6. 差分をユーザーに見せ、実行してよいか確認する。
7. 確認が取れたら `schedule_apply` を呼ぶ。結果の `result.reserve.failed`/`result.favorite.failed` を必ず確認し、失敗があれば `code`（`scheduleConflict`/`sessionFull`等）と一緒に伝える。`remainingPlan` に差分が残っていれば「一部反映されていない」とユーザーに伝える。

## 「競合を解消したい」「どれを諦めればいい？」

`conflicts_get` を呼ぶ。
- `sessionConflicts`: 予約同士の重複。各グループの `recommended`（推奨セッションID）と `reasons`（再演や類似セッションの有無という事実に基づく理由）をそのままユーザーに見せる。Claude自身の主観で推奨を変えない。
- `personalTimeConflicts`: 予約と個人予定（基調講演など）の重複。どの予約がどの個人予定と重なっているかを伝える。re:Roadieが書き込んだ移動時間ブロック・リマインダーは対象外。
- 組み直したい場合は、予約中のIDを候補として `schedule_optimize` に渡すと、再演への差し替えを含めた解消案が得られる。

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
