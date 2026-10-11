# 設計と実機確認の記録

re:Roadie（パッケージ名 `session-roadie`）の設計方針と、AWS Events API を実際に使って確かめた結果の記録です。使い方は [README](../README.md) を参照してください。

日付は、確認した日です。API の挙動は変わる可能性があるため、古い記録には日付を残しています。

## 1. 構成と方針

**目的:** re:Invent 参加者の意図とプロフィールをもとに、AWS Events API（REST）でセッションの計画・予約・移動時間の確保・変更の追従を行い、結果を公式アプリの個人スケジュールに書き戻すローカルのエージェント。

**構成:** Node.js / TypeScript 製。AWS Events REST API に、Builder ID の OAuth 2.0 Authorization Code + PKCE でサインインします。ローカルの JSON ストアに、カタログのスナップショットと、プロフィール・意図・メモを保持します。書き込みは「意図」を唯一の情報源にし、`GetSchedule` との再照合で冪等に収束させます。

**使用技術:** TypeScript、Node.js 22 以上（プレーンな JSON ストア）、`commander`（CLI）、`open`（ブラウザ起動）、`vitest`（テスト）、標準の `fetch`、`@modelcontextprotocol/sdk`（MCP サーバー）。

**守っていること（制約）**

- ホスティングしない。全機能は、利用者のローカルマシンで動作する。
- カタログデータをリポジトリにコミットしない。プロフィール・意図・メモもローカル保存のみで、サンプルはダミー値にする。
- クォータを厳守する。`ListSessions`/`GetSession` 120 回/分、`GetSchedule` 60 回/分、書き込み系 30 回/分（セッション単位）。`429` は `Retry-After` に従ってリトライする。
- 書き込みは冪等に再照合する。`GetSchedule` を都度取り直し、意図との差分だけを送る（公式ドキュメントの「Retrying a write safely」に沿う）。
- `ListEvents` は ongoing/upcoming のみ返るため、会期中にローカルスナップショットを保存しないと、帰国後の機能が成り立たない。

**層の分け方**

```
Claude Code → スキル/コマンド（手順だけ） → re:Roadie（ロジックは全部ここ） → AWS Events REST API
```

- **意図の解釈は LLM（Claude Code）側、決定的なロジックは re:Roadie 側**という役割分担にしています。差分計算、冪等な再照合、移動時間の計算、クォータ制御、代替の判定は、すべて re:Roadie にあります。
- MCP サーバーの内部に、Bedrock などの LLM 呼び出しを埋め込む設計は採っていません（2026-10-01 の判断）。Claude Code 自身が推論を担うため二重になること、Bedrock は別途 AWS アカウントと IAM 権限が必要で、設置の手間が増えることが理由です。
- 書き込み系ツールは、`*_plan`（差分を見せるだけで実行しない）と `*_apply`（実行する）に分けています。CLI の確認プロンプト（`-y`/`--yes`）に当たる「確認してから実行する」動作は、MCP 越しでは、クライアント側（スキル経由の Claude）が担います。
- `.mcp.json` でプロジェクトスコープの MCP サーバーとして登録し、`.claude/skills/re-roadie/SKILL.md` には、ツールを呼ぶ順番の手順だけを書きます（ロジックはスキル側に持たせません）。

## 2. API 調査で確定した事項

OpenAPI 定義（`https://api.awsevents.com/v1/openapi.json`）を取得・解析した結果と、実データでの確認です。

| 調べたこと | 結果 |
| --- | --- |
| セッション属性は取れるか | `Session` に `type`（形式）、`level`、`venue`、`room`、`speakers[]`、`topics[]`、`tracks[]`、`industries[]`、`areasOfInterest[]`、`roles[]`、`services[]`、`segments[]`、`features[]`、`customerPersonas[]`、`experiences[]`、`focusAreas[]` がある。**2026-09-28 の実データ確認では、実際に値が入るのは `areasOfInterest`/`features`/`industries`/`roles`/`services`/`topics`/`speakers`（`name` のみ）。** `tracks`/`segments`/`customerPersonas`/`experiences`/`focusAreas`/`additionalActivities` は、約 1500/2043 件のサンプルで一度も出現しなかった |
| 再演（repeat）を識別できるか | 専用フィールドは無い。**2026-09-28 の実データ確認で確定:** サフィックスは番号なしの `-R` のみ（例 `CON402-R`、`CMP333-R`）。`-R1` のような連番は、この時点では見られなかった。`GetSession` の全フィールドにも、元のセッションへのリンクは無く、`abbreviation` から `-R` を除いた番号と、タイトルの一致で紐付けるしかない。**その後、実データが増えて、状況が変わった:** 2026-10-01 のカタログでは `-R` 485 件・`-R1` 436 件・`-R2` 以降 9 件が混在し、元の番号が存在しない組も多かった。2026-10-08 のカタログでは、`-R` 483 件・`-R1` 483 件・`-R2` 16 件・`-R3` 2 件・`-R4` 1 件だった。実装（`src/planning/alternatives.ts`）は、`-R` と、`-R` に続く連番の両方を、同じ元番号の再演として扱う |
| オンデマンド公開を属性で取れるか | 取れない。`Session.type` の文字列からの推定に頼るしかないため、断定は避ける |
| `GetSchedule` は個人予定のテキストを返すか | 返す。`Schedule.personalTime[]` は `PersonalTime`（`title`、`description`、`location` を含む）の配列 |
| クォータ | 確定（公式の quotas ページ）。上記のとおり。`429` は `Retry-After` 秒を返す |
| `ListSessions` の全件取得の規模 | 1 ページ最大 250 件で、`totalCount` と `nextToken` が付く。120 回/分の枠内なら、数千件でも数ページで収まる |
| 競合の解消 | **API 側で解決済み。** `ReserveSessions`/`AssociateFavorites` は `BulkResult{successful[], failed[]}` を返し、`failed[].code` に `scheduleConflict`/`sessionFull`/`alreadyScheduled`/`timePassed`/`other` などが入り、`conflictsWith[]` に衝突する予約済みセッションの ID が入る。API の応答をそのまま使える |
| 座席の空き状況 | `SeatAvailability` は件数ではなく、バンド（`available`/`limited`/`veryLimited`/`unavailable`/`walkUp`）。2026-09-28 時点（予約 API の開放前）は、サンプル全件が `isReservable: false`、`seatAvailability: null` だった。**2026-10-08 の同期では値が入っていた**（変更として返った 2175 件のうち、`isReservable: true` が 1424 件） |

### 2026-09-28: MCP サーバー経由の実データ確認

`awsevents` MCP サーバー経由で、`reinvent2026` に `ListSessions`（7 ページ、約 1500/2043 件）・`GetSession`・`GetSchedule` を実行して、上の表を検証しました。

- **イベント基本情報:** `eventId: reinvent2026`、`authenticationRequired: true`、会期 2026-11-30〜12-04（America/Los_Angeles）、`totalCount: 2043` セッション。`ListSessions` は、署名済みトークンがあれば、認証必須のイベントでも、ページングで全件を取得できた。
- **セッションタイプ:** サンプル範囲で `Breakout session`、`Chalk talk`、`Workshop`、`Builders' session`、`Code talk`、`Gamified learning`、`Lightning talk` の 7 種を確認した。オンデマンド公開を示す専用フィールドは無い。
- **`GetSchedule` の挙動:** 自分のスケジュールが空の状態で、`{"schedule":{"favorites":[],"personalTime":[],"reserved":[]}}` を返した。
- **未検証だった点:** `429`/`Retry-After` の実際の挙動（サンプリングのペースでは発生しなかった）。

### 2026-09-28: `CreatePersonalTime` の実書き込み検証

テスト用の個人予定を作成し、`GetSchedule` で確認し、`DeletePersonalTime` で削除しました（実際のスケジュールに反映されるため、確認後は全件削除済み）。

- **`title` に `[` や `]` を含むと、`400 The personal time entry could not be applied` で拒否される。** 日本語は問題なく通る。ASCII でも `[Test] bracket check` は失敗し、括弧だけ外した `Test bracket check without brackets` は成功した。エラーレスポンスに詳細コードは無く、HTTP ステータスとメッセージだけなので、`title`/`description` のサニタイズが必要（実装は `[`/`]` を全角の `〔`/`〕` に置換している）。
- **`location` を省略すると、`"Personal"` がデフォルト値として入る。**
- **書き込み成功時のレスポンスは `{"content":""}` で、作成された `personalTimeId` は返らない。** ID を得るには、直後に `GetSchedule` を呼び直す必要がある（再照合の設計と合致する）。
- **`DeletePersonalTime` は成功時も `{"content":""}`。** 存在しない ID を消しても成功するため、二重送信の冪等性は保たれる。
- **`CreatePersonalTime`/`DeletePersonalTime` は、予約 API の開放（10/8）を待たずに動作した。** 予約系（`ReserveSessions`/`CancelReservation`）とは別枠で、書き込み制限の対象外だった。

## 3. 2026-10-01: Builder ID サインインと書き込み系の実機確認

Builder ID で実際にサインインし、`sync`/`schedule`/`apply`/`CreatePersonalTime` を、本人のアカウントに対して実行しました。実装時には気づけなかった、実データとの食い違いを 4 件見つけて、修正しました。

1. **書き込み系のエンドポイントパスが誤っていた。** `/v1/events/{eventId}/schedule/favorites` のように、余分な `/schedule/` が入っていた（正しくは `/v1/events/{eventId}/favorites`）。誤ったパスは、API Gateway 既定の IAM オーソライザーにフォールバックし、`403 Invalid Authorization header` になっていた。`openapi.json` の `paths` で確認して修正した。
2. **`GetSchedule` のレスポンスは `{"schedule": {...}}` と、`schedule` キーでラップされている。**
3. **`AssociateFavorites`/`ReserveSessions` のレスポンスは `{"result": BulkResult}` と、`result` キーでラップされている。**
4. **書き込み系（`CreatePersonalTime` など）の成功レスポンスは、204 No Content（ボディなし）。** `res.json()` を無条件に呼んでいたため、204 で失敗していた。

### 公式アプリへの反映にはラグがある

API（`CreatePersonalTime`）で作った個人予定は、作成直後には、スマートフォンの公式アプリ（iOS/Android）のカレンダーに表示されませんでした（プルリフレッシュやアプリの再起動でも変わらず）。一方、アプリで手動作成したお気に入り・個人予定は、直後から `GetSchedule` で取得できました。時間を置くと、API 経由の個人予定もアプリに表示されました。

**サーバー側のデータは即座に正しく共有されるが、公式アプリの表示への反映には、数分〜十数分のラグがある**と判断しています。

### イベント情報とタイムゾーン

`GetEvent`（`/v1/events/reinvent2026`）の実データは、`startDate: 2026-11-30T05:30:00.000-08:00`、`endDate: 2026-12-04T23:59:00.000-08:00`、`timezone: America/Los_Angeles` でした。`timezoneAbbreviation` は `"PDT"`（夏時間の表記）ですが、`startDate`/`endDate` のオフセットは明示的に `-08:00`（冬時間、PST）なので、`timezoneAbbreviation` は無視して、オフセットの値を信頼しています（`src/schedule/sessionTimeUtc.ts` が PST 固定 = UTC-8 としているのは、これが根拠です）。ただし、公式の agenda ページは「All times are Pacific Daylight Time (PDT)」と書いており、サーバーやページ側がどちらの基準で計算しているかは、実機だけでは確定できていません（未解決）。

## 4. 2026-10-01: 実運用で見つかった制約

「Agentic AI 中心に予定を組む」依頼を、実機で行いました。カタログからの絞り込み、お気に入りの登録、基調講演の個人予定の作成までを実際に行い、次の点がわかりました。

1. **`apply`（reconcile ベース）を分割して実行すると、既存の項目を消してしまう。** `AssociateFavorites` は、1 リクエストあたり `sessionIds` が最大 10 件です。25 件のお気に入りを 10 件ずつ 3 回に分けて `apply` したところ、1 回目で、desired に含まれていなかった既存のお気に入りが解除されました。`reconcile` は「desired に無いものは全部外す」完全な置き換えの設計で、複数回に分けた追加には向きません。10 件を超えて追加するときは、既存分を含めた累積のリストを渡す必要があります（10 件を超えたときの自動のバッチ分割は、この時点では未実装）。
2. **`CreatePersonalTime` は、日をまたぐと 400 エラーになる。** `startDateTime` と `endDateTime` の日付（UTC 基準）が異なると、5 分刻みなどの条件を満たしていても、`400 The personal time entry could not be applied` で拒否されます。公式ドキュメントには、この制約の記載がありません。日をまたぐ可能性のある個人予定は、呼び出し側で日付境界で分割する必要があります（現在のコードは、日中のセッション時間を前提にしており、影響を受けない）。
3. **基調講演は、API の「セッション」として存在しない。** `ListSessions` にタイプ `Keynote` は無く、タイトルに "Keynote" を含むセッションも 0 件でした。基調講演の日時は、公式サイトの agenda ページにだけ掲載されています。そのため、`CreatePersonalTime` で、基調講演の時間帯を個人予定として書き込んで対応しました。

## 5. 失敗パターンと、テストで固定していること

実装前に洗い出した失敗パターンは、テストで固定しています。

- 部分成功（`BulkResult.failed`）を無視して、「全件成功」と誤表示する。
- `429` を受けて、リトライせずに失敗扱いにする（`Retry-After` を守らないと、信用低下のリスクがある）。
- `CreatePersonalTime`/`UpdatePersonalTime` の時刻が UTC で 5 分刻み必須という制約を無視して、`400` になる。
- 書き込みのタイムアウト後に、同じリクエストを再送して、`CreatePersonalTime` が二重に登録される。
- プロフィール・意図・メモのファイルが無いときに、全機能が落ちる。
- `title`/`description` に半角の `[` `]` を含めて、`400` になる。
- 成功レスポンスに `personalTimeId` が無く、直後に `GetSchedule` を呼ばないと、新規エントリを特定できない。

## 6. エラー処理の設計

2026-10-08 の予約 API 開放で、`ReserveSessions`/`CancelReservation` の実レスポンスを初めて確認することになるため、想定外の応答が来たときに原因を追えるよう、次の 3 点を直しました。

1. MCP 経由では、エラー本文が消えていた。`errorResult` は `err.message` だけを返し、`ApiError` の message は `"API error 409"` 固定で、`body` を含まなかった。
2. 途中の例外で、実行済みの工程が分からなくなっていた。`executeReconcilePlan` は、予約、お気に入りの追加、取消、解除を順に実行する。1 つ目が throw すると、以降は未実行のまま、何が実行済みかも返らなかった。
3. スキルの失敗時の案内が、「403/409 なら予約 API 未開放の可能性」の 1 行だけだった。

### エラー変換層（`src/errors.ts`）

`toRoadieError(err: unknown): RoadieError` に、変換を集約しています。

```ts
interface RoadieError {
  kind: 'authExpired' | 'notOpenYet' | 'forbidden' | 'rateLimited' | 'network' | 'unknown';
  status?: number;
  operation?: OperationName;
  message: string; // 日本語1文。原因
  hint: string;    // 日本語1文。次にすること
  body?: unknown;  // APIのエラー本文（あれば）
}
```

判定は、次の表を上から順に評価します。

| kind | 条件 | hint |
| --- | --- | --- |
| `authExpired` | `ApiError.status === 401` | `auth_login` でサインインし直して再実行する |
| `notOpenYet` | `operation` が `ReserveSessions`/`CancelReservation` で、status が 403 または 409 | 予約 API は 2026-10-08 開放予定で、未開放の可能性がある。お気に入り・個人予定の操作は影響を受けない |
| `forbidden` | 上記以外の 403 | 権限またはエンドポイントを確認する。body を確認 |
| `rateLimited` | 429（`QuotaLimiter` のリトライ上限を超えたもの） | 少し待って再実行する |
| `network` | `TypeError` のうち、message が `fetch failed` のもの（それ以外の `TypeError` は、バグの可能性があるため `unknown`） | 接続を確認して再実行する |
| `unknown` | 上記以外（5xx を含む） | body をそのまま提示する |

`ApiError` には `operation` を追加し、`message` を `API error ${status} (${operation})` にしました。body は `body` プロパティに保持します。出力側は、MCP が `toRoadieError` の結果を JSON で返し（`isError: true` は維持）、CLI は「エラー」「次にすること」と、body がある場合の「詳細」を表示します。

### `executeReconcilePlan` の工程分離

4 つの工程（予約、お気に入りの追加、取消、解除）を、独立に実行し、結果を工程ごとに持ちます。

```ts
type StepResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RoadieError }
  | { ok: false; skipped: true };

interface ApplyResult {
  reserve: StepResult<BulkResult>;
  favorite: StepResult<BulkResult>;
  cancelReservation: StepResult<ItemResult[]>;
  unfavorite: StepResult<ItemResult[]>;
}
```

- ある工程が例外で失敗しても、次の工程を続行する（例: 予約が `notOpenYet` でも、お気に入りの変更は実行される）。
- 失敗が `authExpired` の場合だけ、以降の工程を即中断し、`skipped` にする（以降もすべて 401 になるため）。
- 取消・解除は、セッション単位のループで、1 件の失敗で残りを止めない。
- `schedule_apply` は、実行後に `GetSchedule` を取り直して、`remainingPlan` を返す。この再照合が失敗したときは、`reconcileError` を返し、`remainingPlan` は省略する。
- CLI の終了コードは、工程の失敗・件ごとの `error`/`skipped`・`reconcileError` のいずれかがあれば 1 にする。`BulkResult.failed`（`scheduleConflict` など、API 応答上の失敗）は、従来どおり 0 のままにする。

### 既知のリスク

- `notOpenYet` の判定は、403/409 に依存している。開放後に別のステータスで未開放を返す場合は、判定表の更新が必要。
- トークン無しで呼ぶと、API Gateway 既定のオーソライザーが 403 を返すことがあり、その場合は `authExpired` ではなく `forbidden` と判定される。`auth_status` を先に呼ぶスキルの手順で、回避する前提にしている。

## 7. 2026-10-08 の確認

予約 API の開放日に、実機で確認したことです。

- **`ReserveSessions` は、HTTP 409「This operation is currently disabled」で拒否された。** 開放前の状態と推測している。同じ日の `GetSchedule` の `reserved` には、予約済みのセッションが入っていた（re:Roadie からの予約は成功していないため、公式アプリでの予約と推測している。未確認）。
- **`GetSchedule` の個人予定の時刻の規約が、取得したデータの中で混在している。**（2026-10-11 に解消。§8 を参照）re:Roadie が書き込む移動ブロックとメモのリマインダーは UTC で保存していたが、基調講演などの個人予定には、説明に「現地時刻のまま保存」とあり、PST の値そのもので保存されている。
- **座席の空き状況に、値が入っていた。** 空席状況（`available`/`limited`/`veryLimited`/`unavailable`）が、実データに入っていることを確認した。

## 8. 2026-10-11 の確認

- **`ReserveSessions` が開放されていた。** 2026-10-11 に再実行したところ、409 は返らなかった。
- **満席の失敗は `failed[].code` の `sessionFull` で返った。** お気に入りのうち 5 件（`OPN401-R`、`AIM301-R1`、`MAM348`、`AIM336-R1`、`TNC336-R`）が `sessionFull` で失敗した。予約は 11 件のまま変わらなかった。設計時の想定どおり、API の `BulkResult` をそのまま使えている。
- **`ReserveSessions` の成功を確認した。** `seatAvailability` が `limited` の `ANT409`（Chalk talk、12/3 08:30）を 1 件予約し、成功した。`apply` の再照合（`GetSchedule`）で、予約が 11 件から 12 件になり、あるべき状態と一致することも確認した。
- **`CancelReservation` の成功を確認した。** 予約した `ANT409` を `apply`（`reserve` から外す）で取り消したところ、結果は `deleted` で、`GetSchedule` の再照合で予約が 12 件から 11 件に戻り、他の予約に影響しないことを確認した。
- **注意点。** `seatAvailability` が `available`/`limited`/`veryLimited` でも満席のことがあり、空席表示は予約の可否を保証しない。
- **個人予定の時刻は、現地時刻で書くことに統一した。** 公式アプリは保存値をそのまま表示することを、実機で確認した。次のように直した。
  - 移動ブロックとメモのリマインダーは、UTC ではなく現地時刻で書く（`toPersonalTimeDateTime`）。
  - 個人予定との重なり判定は、保存値を現地時刻として読む（`personalTimeRangeUtc`）。直す前は、保存値を UTC として読んでいたため、重なっていない予約（例: 11/30 08:30 のセッションと、同日 16:00 の Welcome reception）を重なると誤検出していた。直したあとは、現在の予約 11 件に重なりはない。
  - `re-roadie view` は、移動ブロックも含めて、保存値をそのまま現地時刻として描く。
  - 直す前に UTC で書いた移動ブロック・リマインダーが公式の予定に残っていると、時刻がずれて見える。この日の時点では、残っていなかった。
- **現地時刻で書いた個人予定が、アプリでも書いた時刻で表示された。** 12/1 11:00〜12:00 の「Expo会場めぐり」を `CreatePersonalTime` で現地時刻のまま書いたところ、公式アプリでも 11:00〜12:00 で表示された（2026-10-11、本人による確認）。移動ブロックとリマインダーの書き込みは、同じ形式に変えたが、実際に書いての確認は、まだしていない。

## 9. 開発中の計画書について

実装中は、AI エージェント向けの、手順ごとの実装計画書を使っていました。ステップごとのコード片が大半で、読み物としては長いため、公開用には、この文書にまとめました。元の計画書は、公開リポジトリには含めていません。
