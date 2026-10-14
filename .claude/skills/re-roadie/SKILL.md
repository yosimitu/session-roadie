---
name: re-roadie
description: re:Invent の参加者の意図をもとに、session-roadie MCPサーバー（auth_status/catalog_sync/catalog_search/profile_get/schedule_optimize/schedule_get/schedule_plan/schedule_apply/conflicts_get/travel_blocks_plan/travel_blocks_apply/notes_*/onboarding_save/catalog_watch/sessions_now/seat_forecast/detour_suggest/catalog_trends）を使ってセッション計画・予約・移動時間確保・メモ反映・空席の見張り・いまから行けるセッションの提示・満席予報・寄り道の提案・カタログの傾向の説明を行う手順。「re:Invent の予定を整えて」「今日の予定を組んで」「移動時間を確保して」「メモをリマインダーにして」「いまから行けるセッションは？」「満席になりそうなものは？」「寄り道できるセッションを探して」「今年は何が多い？」のような依頼があったときに使う。
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
- `status: shrunk`: 取得件数が前回の半分未満。部分的な応答の可能性があり、状態は更新されていない。時間をおいて再実行するよう案内する。
- `status: checked`: `lines` をユーザーに見せる。種類は `seatOpened`（満席だったお気に入りの空席表示）、`altSeatOpened`（満席のお気に入りの再演の空席表示）、`newMatching`（プロフィールに合う新着）、`changedMine`（予約・お気に入りの会場や時間の変更）、`removedMine`（取消）。
- 空席表示は**予約できることを保証しない**（`limited` でも満席のことがある）。「予約を試しますか」と聞き、希望があれば `schedule_plan` → 確認 → `schedule_apply` の順に進む。このツール自体は予約しない。
- `changedMine` / `removedMine` は、予約の時間が他の予約と重なっていないか `conflicts_get` で確認するよう添える。
- `catalog_watch` と `re-roadie watch` は同じ状態ファイルを共有する。片方が確認すると、もう片方からは同じ変化が見えなくなるので、どちらか一方で使うよう案内する。

## 「いまから行けるセッションは？」「次の予定まで時間がある」

`sessions_now` を呼ぶ。現在地は、開催中または直近3時間以内に終わった予約の会場から決まる。分からないときは `venue` を聞く。会期の外で試すときは `at`（会場の現地時刻 "YYYY-MM-DD HH:MM"）を渡す。

- 返る `lines` をそのまま見せる。`items` が本体で、順序は、お気に入り、関心トピック、空席の多い順、開始の近い順。
- `queue` は満席表示のセッション。公式 FAQ では、各セッションに当日並ぶ人（walk-up）向けの席が一部残されており、予約できなくても現地の列に並べば入れる場合がある。**席は保証されない**ので、「入れる」とは言わず、「列に並ぶ選択肢がある」と伝える。早めに並ぶ前提も添える。
- **予約した席は、開始の10分前までに部屋に着かないと譲られる**（公式 FAQ）。間に合うかの判定には、移動時間に10分を足してある。
- `isReservable` が false のもの（Expo の発表など）には「予約の対象外」と出る。予約操作の対象にしない。
- 前提として `catalog_sync` が新しいこと。古いと、満席になったものや新しいものが反映されていない。必要なら先に `catalog_sync` を勧める。
- 空席表示は**予約できることを保証しない**。`walkUp` は当日会場で並ぶ形式と思われるが、未確認なので断定しない。
- 予約は、ユーザーが選んだら `schedule_plan` → 確認 → `schedule_apply` の順に進む。このツール自体は予約しない。

## 「満席になりそうなセッションは？」「穴場はある？」

`seat_forecast` を呼ぶ。返りは `urgent`（近いうちに埋まりそう）、`hidden`（動いていない関心トピックの穴場）、`freeing`（空きが増えている）。

- **見積もりであることを必ず添える。** 空席表示の段階が進む速さが続くと仮定した値で、残席数ではない。`confidence` が `low` のうちは参考程度と伝える。
- 履歴が2日分に満たないときは予報が出ない。`catalog_sync` か `catalog_watch` を続けると履歴がたまる、と案内する（毎日の `re-roadie watch` もためる）。
- `urgent` のお気に入り（`isFavorite`）は、先に押さえるよう勧める。予約は `schedule_plan` → 確認 → `schedule_apply`。

## 「寄り道できるセッションを探して」「いつもと違うものを入れたい」

`detour_suggest` を呼ぶ。予約のある日ごとに、予約の合間に収まる候補が返る。`dates` で日を絞れる。

- 候補は、関心の強さ（`affinity`）が小さい順で、3以下だけ。0 は関心の外。大きいほど、似たトピックの予約・お気に入りが多い。
- ランダムではない。同じ状態なら同じ結果になる。別の候補を見たいときは `perDay` を増やす。
- 候補が出ないのは、空き時間が短いか、収まるセッションが残っていないとき。その旨を伝える。
- 予約は、ユーザーが選んだら `schedule_plan` → 確認 → `schedule_apply` の順に進む。このツール自体は予約しない。

## 「今年は何が多い？」「増えた話題は？」「自分の関心は全体と比べてどう？」

`catalog_trends` を呼ぶ。`since`（比べる基準日。省略時は保存済みで最も古い日）と、数えたい語の `keywords`（例 `["AgentCore","Kiro"]`）を渡せる。

- 返る `lines` をそのまま見せる。話題・サービス・形式・レベル・日別、増えたサービス（`risingServices`）、タイトルに増えた語（`risingTerms`）、`personal`（予約・お気に入りが全体より多い／少ない話題）が入る。
- **数字の読み方を必ず添える。** 件数はカタログの掲載数で、AWS の注力や参加者数を表すとは限らない（非公開から公開になっただけで増えることもある）。語の数はタイトルに含まれるかだけで、別の言い方は拾えない。「注力している」「流行っている」と断定しない。
- 比べる過去のスナップショットがない（`baselineDate` が無い）ときは増減が出ない。`catalog_sync` を毎日続けるほど、日ごとの変化が取れると案内する。
- `personal` はサインインしているときだけ出る。出ていないときは `notes` の理由を伝える。
- 気になる語が出たら、`catalog_search` でそのセッションを探すよう勧める。

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
