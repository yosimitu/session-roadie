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
- 失敗したときの扱いは下の「エラー時」に従う。
- カタログのセッション情報（タイトル・abstract等）は英語のみ。ユーザーにセッション情報を提示するとき（予定一覧・競合の提案・メモのリマインダーなど）は、英語タイトルに加えて日本語訳・簡潔な説明を併記する。

## サインイン確認

何かする前に `auth_status` を呼ぶ。アクセストークン（約1時間）が切れていても refresh token で自動更新できれば `signedIn: true`（`refreshed: true`）が返るので、再ログインは不要。`signedIn: false` のときだけ `auth_login` を呼ぶ（ブラウザが開くので、ユーザーに「ブラウザでBuilder IDにサインインしてください」と伝えて完了を待つ）。

## 初めての参加者

意図やプロフィールが無い状態で「どう過ごせばいいか分からない」と言われたら、`onboarding_save` を使う。ユーザーに次の質問をする（1〜3は必須、4以降は任意。「未定」「特になし」「制限なし」でよい）。

1. 普段の仕事は？ → `infrastructure`/`appDev`/`data`/`management`
2. 今回の一番の目的は？ → `learning`/`research`/`networking`/`report`
3. 体力に自信は？ → `packed`/`normal`/`relaxed`
4. 参加できる日は？ → `firstDay`/`lastDay`（`2026-11-30`〜`2026-12-04`）
5. 関心のあるテーマは？（複数可） → `agenticAI`/`security`/`data`/`appDev`/`infrastructure`/`migration`
5-b. 選んだテーマの優先順位は？（5で2つ以上選んだときだけ。任意） → `themePriority`（`interests` に含まれるものを、1位から。重複なし）。省略すると、おすすめの重みは公式お気に入りのトピックの傾向から決まる
6. 希望するレベルは？ → `maxLevel`: `200`（入門・基礎まで）/`300`（実践まで）/省略（制限なし）。200までだと全体の約8割が除かれるので、選ぶ前にそのことを伝える
7. スポンサーセッション（企業提供）は避けたい？ → `excludeSponsored`
8. これより前に始まるセッションは避けたい？（時差対策） → `earliestStart`（例 `09:00`）
9. 予約するセッションが昼（12:00〜13:00）にかかるとき警告してほしい？ → `lunchBreak`（除外はしない）
10. 動かせない予定（会食・社内会議など）は？ → `fixedEvents`（`date`/`start`/`end`/`title`）。公式アプリには書き込まず、予定の組み立てで避けるだけ

回答を `onboarding_save` に渡すと、`data/profile.yaml` と `data/intent.txt` が作られる。保存した回答は以降の `schedule_optimize`/`catalog_search` に既定値として自動で効く（体力→1日の上限本数・最低空き時間、目的→優先する形式、参加日→対象日、希望レベル・スポンサー→`catalog_search` の絞り込み、開始時刻・固定の予定→`schedule_optimize` の制約、昼休み→`schedule_optimize`/`schedule_plan` の `warnings`）。結果の `optimizeDefaults` をユーザーに見せ、「この条件で組みます」と伝える。

## 「今日の予定を組んで」「セッションを予約して」

1. `catalog_sync` でカタログの差分を取り、新着・変更・キャンセルがあればユーザーに伝える。
2. `profile_get` でプロフィールと意図を読む。`profile` が `null` なら、上の「初めての参加者」の質問を提案する（断られたら、その場の自由文の意図だけで進める）。`interestTopics` があれば `catalog_search` の `topics` に使う。
3. ユーザーの意図（その場の自由文と `intent`）を検索条件に変換し、`catalog_search` で候補を絞る。**この「意図の解釈」はこのスキル（Claude）の仕事**で、session-roadie側にはない。"agent" のような頻出語は abstract まで含めると半数以上に当たるので、`keywordScope: "title"` やトピック・形式・日付で絞る。既存のお気に入り（`schedule_get`）も候補の材料にする。参加日・希望レベル・スポンサー除外がプロフィールにあれば `dates`/`maxLevel`/`excludeSponsored` は自動で絞られる（`appliedProfileDefaults`）。ユーザーが明示的に400以上を求めたときは `maxLevel` を引数で上書きする。
4. 候補IDを `schedule_optimize` に渡す。再演（-R/-R1…）への差し替え・個人予定（基調講演など）・会場間の移動時間・プロフィール（1日の上限本数・最低空き時間・優先形式・参加日）を考慮した、重ならない最大の組み合わせ（`reserve`）が返る。適用した条件は `appliedOptions` で返るので、ユーザーに伝える。その場で「今日は詰め込みたい」などと言われたら、`maxSessionsPerDay` 等を引数で上書きする。`dropped`（入らなかった候補と衝突相手。`dailyLimit`＝上限本数、`outsideAttendance`＝参加日外、`beforeEarliestStart`＝開始時刻より前、`fixedEvent`＝固定の予定と重なる）。`warnings`（`lunchOverlap`）があれば、昼にかかる回として伝える（除外はされていない）。`schedule_plan` の `warnings` も、確認を取る前にユーザーへ伝えると `substitutedFor`（差し替えた回）もユーザーに伝える。`optimal: false` なら探索上限で打ち切った近似解であることも伝える。
5. `schedule_plan` に `reserve` を渡して差分を取得する（お気に入りを変えないなら `favorite` は省略する）。
6. 差分をユーザーに見せ、実行してよいか確認する。
7. 確認が取れたら `schedule_apply` を呼ぶ。結果は工程ごと（`result.reserve`/`result.favorite`/`result.cancelReservation`/`result.unfavorite`）に `ok` を持つ。`ok: true` の `reserve`/`favorite` は `value.failed` を確認し、失敗があれば `code`（`scheduleConflict`/`sessionFull`等）と一緒に伝える。`cancelReservation`/`unfavorite` の `value` は1件ずつの結果で、`error` が付いた件は失敗、`skipped` は未実行。`ok: false` の工程は `error.kind` に従い、下の「エラー時」で案内する（`skipped` の工程は認証切れによる未実行）。`remainingPlan` に差分が残っていれば「一部反映されていない」と伝える。`remainingPlan` の代わりに `reconcileError` が返ったときは、実行後の状態を確認できていないことを伝え、`schedule_get` で確認するよう案内する。

## 「競合を解消したい」「どれを諦めればいい？」

`conflicts_get` を呼ぶ。
- `sessionConflicts`: 予約同士の重複。各グループの `recommended`（推奨セッションID）と `reasons`（再演や類似セッションの有無という事実に基づく理由）をそのままユーザーに見せる。Claude自身の主観で推奨を変えない。
- `personalTimeConflicts`: 予約と個人予定（基調講演など）の重複。どの予約がどの個人予定と重なっているかを伝える。re:Roadieが書き込んだ移動時間ブロック・リマインダーは対象外。
- 組み直したい場合は、予約中のIDを候補として `schedule_optimize` に渡すと、再演への差し替えを含めた解消案が得られる。

## 「予定を俯瞰したい」「今日の予定をPCで見たい」「新しいセッションを確認したい」

`schedule_view` を呼ぶ。`data/schedule.html` に、タブ付きの1枚のHTMLが書き出されるので、ブラウザで開くようユーザーに伝える。**参照専用**で、公式の予定は変更しない。組み直し・予約・取消はこのツールでも、HTMLの上でもできない。

- タブは「予定」（日別と「5日間通し」を切り替えられるタイムライン。`date` でその日だけ。一覧で付けた★メモも右側の列に重なって表示され、予約・個人予定との重複を警告する。「未予約のお気に入りも表示」で、予約と個人予定だけの見通しにもできる）、「セッション一覧」（全件の絞り込み・検索・日本語表示）、「全体像」、「メモ候補」（☆で付けるブラウザ内のメモ。こちらには伝わらず、公式の予定にも反映されない）。
- 「セッション一覧」の「おすすめ順」「おすすめ」の印は、お気に入りの傾向（優先順位があればそれで上書き）と、予約・個人予定・空席などの条件から、生成時に計算した点数。理由と基準は画面に出る。点数は目安なので、聞かれたら基準（重みの出どころ）を説明し、優先順位を変えたいときは `onboarding_save` で `themePriority` を保存し直す。
- 「新着」は、比較元のスナップショットに無かったセッション。既定は今日より前で最新の日付別スナップショットで、`newSince` で変えられる（`catalog_sync` の `availableDates` で保存済みの日付が分かる）。**直前の同期ですでに取り込み済みだと 0 件になる**ので、0 件のときは `newSince` を古い日付にして出し直すことを提案する。
- 時刻はすべて会場現地（PST）。日本時間は +17時間。
- タイトル・概要はカタログのとおり英語。ブラウザ（Chrome）内の翻訳ボタンで日本語訳できる。こちらでの日本語訳が必要なときは、`schedule_get` や `catalog_search` の結果をもとに別に用意する。
- 警告（重複・個人予定との重複・移動不足・昼にかかる）が出ていたら、件数と該当セッションをユーザーに伝える。
- 新着や空席を見て「組み直したい」と言われたら、HTMLではなく、通常の流れ（`schedule_optimize` → `schedule_plan` → 確認 → `schedule_apply`）で行う。

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

## 「空いたら教えて」「新しいセッションは？」「予定が変わっていない？」

`catalog_watch` を呼ぶ（1回の確認。繰り返したいときは、ユーザーに `/loop` か、ターミナルの `re-roadie watch --interval 10` を案内する）。

- `status: baseline`: 初回。基準を保存しただけなので、「次回から変化を知らせる」と伝える。
- `status: empty`: カタログが空（`ListSessions` が0件）。状態は更新されていない。時間をおいて再実行するよう案内する。
- `status: checked`: `lines` をユーザーに見せる。種類は `seatOpened`（満席だったお気に入りの空席表示）、`altSeatOpened`（満席のお気に入りの再演の空席表示）、`newMatching`（プロフィールに合う新着）、`changedMine`（予約・お気に入りの会場や時間の変更）、`removedMine`（取消）。
- 空席表示は**予約できることを保証しない**（`limited` でも満席のことがある）。「予約を試しますか」と聞き、希望があれば `schedule_plan` → 確認 → `schedule_apply` の順に進む。このツール自体は予約しない。
- `changedMine` / `removedMine` は、予約の時間が他の予約と重なっていないか `conflicts_get` で確認するよう添える。

## カタログが0件のとき（`catalog_sync` が「0件」で失敗する）

公式APIの `ListSessions` が空を返すことがある（予約解禁の前後など）。保存済みのスナップショットは空で上書きされないので、いまあるデータでの検索・最適化は続けられる。最新に更新したいときは、時間をおいて `catalog_sync` をやり直すよう案内する。

## エラー時

MCPツールが失敗すると、`isError: true` で次の形のJSONが返る。`message`（原因）と `hint`（次にすること）はユーザーにそのまま伝えてよい。`schedule_apply` では工程ごとの `error` として同じ形で入る。

```json
{ "kind": "...", "status": 409, "operation": "ReserveSessions", "message": "...", "hint": "...", "body": {} }
```

`kind` ごとの振る舞い:

- `authExpired`: `auth_login` を案内し、サインイン後に同じ操作を再実行する。
- `notOpenYet`: 予約APIが未開放の可能性がある（2026-10-08 開放予定）。`schedule_apply` では予約以外の工程（お気に入りなど）は反映済みなので、その旨を伝えて予約だけ保留にする。開放後に同じ `schedule_plan` からやり直す。
- `rateLimited`: 少し待ってから再実行する。短時間に繰り返さない。
- `network`: 接続を確認してもらい、再実行する。書き込み系は再実行前に `schedule_plan` で差分を取り直す（一部が反映済みの可能性がある）。
- `forbidden`/`unknown`: `body` を要約してユーザーに見せる。原因は推測で断定せず、「APIがこう返した」という事実だけを伝える。
