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
  - 移動ブロックの長さを、空き時間すべてから、必要な移動時間だけ（5 分刻みに切り上げ）に変えた。位置は前のセッションの終了直後。直す前は、空き時間が 60 分で必要な移動時間が 15 分でも 60 分のブロックになり、予定を不必要に埋めていた。2026-10-11 に 12/2 の 1 件で、60 分のブロックを削除して 15 分で作り直した（11:30〜11:45）。作り直したあと、サーバー側は 15 分の 1 件だけになったが、公式アプリでは 1 時間のまま見えていた（アプリ側のキャッシュの遅れと推測しているが、未確認）。
  - 直す前に UTC で書いた移動ブロック・リマインダーが公式の予定に残っていると、時刻がずれて見える。この日の時点では、残っていなかった。
- **現地時刻で書いた個人予定が、アプリでも書いた時刻で表示された。** 12/1 11:00〜12:00 の「Expo会場めぐり」を `CreatePersonalTime` で現地時刻のまま書いたところ、公式アプリでも 11:00〜12:00 で表示された（2026-10-11、本人による確認）。移動ブロックとリマインダーの書き込みは、同じ形式に変えたが、実際に書いての確認は、まだしていない。

## 9. カタログの監視（watch）

2026-10-11 の実機確認で、お気に入りの未予約 5 件がすべて満席で、`seatAvailability` が `limited` でも満席のものがありました。公式アプリを繰り返し開かずに済むよう、変化を知らせる `watch` を追加しました。予約は実行しません。

- **取得方法:** `ListSessions` の全件取得を毎回行います（約 9 ページ）。空席、新着、会場・時間の変更、取消が同じ取得で揃い、`GetSession` の個別取得（新着を見つけられない）より単純です。最短 5 分間隔で、120 回/分のクォータに対して余裕があります。
- **状態:** `data/watch-state-<eventId>.json` に、セッションごとの空席・会場・日時・タイトルを保存します。手動の `sync` のスナップショットとは別なので、`sync` を実行しても比較元は変わりません。
- **イベント:** `seatOpened`（満席だったお気に入りの空席表示）、`altSeatOpened`（満席のお気に入りの再演）、`newMatching`（プロフィールに合う新着）、`changedMine` / `removedMine`（予約・お気に入りの変更と取消）。
- **初回:** 基準を保存するだけで、通知しません（新着が一度に大量に出るのを避けるため）。
- **カタログが 0 件のとき:** 状態を作らず・更新しません。2026-10-11 時点で `ListSessions` は 0 件を返し、`GetSession` は 404 を返しています（API 側の一時的な状態と推測していますが、未確認です）。このため、実データでの動作確認は、カタログが戻ってから行います。
- **通知:** `--notify` は macOS の `osascript` を使います。本文と題は引数で渡し、スクリプトの文字列には埋め込みません。それ以外の OS では、コンソール表示のみです。
- **部分的な応答への備え:** 取得件数が前回の半分未満のときは、状態を更新せず、イベントも返しません（`status: shrunk`）。取消の誤検知と、次回の新着の大量通知を避けるためです。同じ `sessionId` が重複して返っても、1 件に畳んでから比べます。`seatAvailability` が一時的に欠けたときは、前回の値を残します（空席から欠落を挟んで空席に戻っても、通知しません）。
- **入力の検証:** `eventId` は英数字・ハイフン・アンダースコアに限ります（状態ファイルのパスに使うため）。MCP の全ツールの入口でも同じ検証をします。
- **制限:** 前回の観測に無い再演に空席表示が出ても、`altSeatOpened` にはなりません（新着として扱い、プロフィールに合わなければ通知しません）。`catalog_watch` と `re-roadie watch` は同じ状態ファイルを共有するので、片方が確認すると、もう片方からは同じ変化が見えなくなります。
- **確認できていないこと:** 実データでの `watch` の動作、`seatAvailability` の更新頻度。macOS の通知（`osascript`）は、実機で呼び出していません。

## 10. 現地・予報・寄り道

2026-10-14 に、現地での使い勝手と席の取りやすさを上げる3つを追加しました。どれも読み取りだけで、予約は実行しません。

- **`now` / `sessions_now`（いまから行けるセッション）:** 開始が「いま＋現在地からの移動時間」以降で、指定の分数（既定 90）以内に始まり、予約・個人予定と重ならず、前後の予定との間に移動時間が取れ、満席表示でないものを返します。現在地は、開催中または直近 3 時間以内に終わった予約の会場から決めます。実際の時刻は `sessionStartUtc` と同じ基準（会場の現地時刻を UTC に直した瞬間）で比べるので、`new Date()` をそのまま使えます。`--at` で現地時刻を指定すると、会期外でも試せます。`walkUp` は当日会場で並ぶ形式と思われますが、未確認です。
- **`forecast` / `seat_forecast`（満席予報）:** 空席表示を 0（available）〜3（unavailable）の段階にそろえ、最初と最後の観測の差を日数で割った速さから、満席までの日数を見積もります。統計的な予測ではありません。履歴は、`sync` が毎回保存する日付別スナップショット（空席表示のあるもの）と、`watch` が記録する `data/seat-history-<eventId>.json` を合わせたものです。2026-10-14 時点で、空席表示を持つ観測は 10-07 と 10-13 の 2 日分で、その間に 624 件の表示が変わり、満席表示は 690 件から 1,146 件に増えました。観測が 3 日未満、または 3 日以上でも期間が短いうちは `confidence: low` です。
- **`detour` / `detour_suggest`（寄り道）:** トピックごとに関心の強さを数えます（プロフィールで宣言した関心は 3、予約は 1 件ごとに 2、お気に入りは 1 件ごとに 1）。セッションの強さは、トピックのうち最大のものです。強さが 3 以下で、予約の合間に収まるものを、強さの小さい順、空席の多い順、予約と形式が違う順、移動が短い順、時刻の早い順に並べます。ランダムは使わず、同じ入力なら同じ結果です。トピックは全部で 18 種類しかなく、完全に関心の外のものだけに絞ると、実データで 5 日中 3 日が候補なしになったため、3 以下まで許しています（中核の分野は 8〜19 になります）。
- **確認できていないこと:** 予報の精度（観測が 2 日分で、検証できていません）、`walkUp` の意味、現地での `now` の実際の使い心地。

## 11. カタログの傾向（trends）

2026-10-14 に、`trends` / `catalog_trends` を追加しました。読み取りだけです。

- **数えるもの:** 話題、サービス、形式、レベル、日別の件数と割合。基準日があれば、その日からの増減、新しく載った・消えたセッション数（`sessionId` の出入り）、増えたサービス、タイトルに増えた語。`--keyword` で指定した語の件数。予約とお気に入りのトピックの割合を全体と比べ、多い／少ない話題を 3 件ずつ。
- **基準日:** 保存済みの日付別スナップショット（`sync` が毎回保存）。省略時は最も古い日。2026-10-14 時点で、10-01 から 10-13 に、2,068 件から 2,234 件（+166）、AI は 985 件から 1,034 件（+49）へ増えました。
- **語の拾い方:** タイトルを英数字で分け、2 文字以上・数字だけでない・除外語（`the`、`aws`、`amazon`、`build` など）以外を数えます。自動で拾うのは、現在 5 件以上のタイトルに出る語だけです。別の言い方（`AI agents` と `agentic`）は同じ語として数えません。
- **レベルの表記ゆれ:** 10-01 は `300 - Advanced`（ハイフン）、10-13 は `300 – Advanced`（en ダッシュ）でした。そのまま数えると、全レベルが「新しく載った」ように見えたため、先頭の 3 桁で数えます。
- **解釈の注意:** 件数はカタログの掲載数です。AWS の注力、参加者数、公開の順序を表すとは限りません（非公開から公開になっただけで増えることもあります）。実際に、MCP や Trainium などは 12 日間で件数が動いていませんが、これを関心の低さとは読めません。
- **サインインできないとき:** 傾向そのものは出し、予約・お気に入りとの比較だけを省いて、理由を `notes` に書きます。
- **確認できていないこと:** 日ごとの推移（履歴は 10-01 以降、日付が飛び飛びです）。

## 12. 開始の10分前までに着く（公式 FAQ の確認）

2026-10-14 に、公式 FAQ（`aws.amazon.com/events/reinvent/faqs/`）で次を確認しました。本文は WebFetch で取得しました（Defuddle は折りたたみの回答を取れませんでした）。

- 予約した席は保証されません。**開始の10分前までに部屋に着かないと、席は当日並ぶ人（walk-up）に譲られます。**
- 各セッションは、当日並ぶ人向けの席を一部残しています。予約できなかったときの案内は「再演（`-R`）を探す、空きを確認し続ける、現地の列に並ぶ」です。
- 会場間のシャトルは、会期中は走り続けます（バッジが必要）。会場間は余裕を見るよう案内があります。

これを次のように反映しました（定数は `ARRIVAL_BUFFER_MINUTES = 10`、`src/schedule/travelTime.ts`）。

- **連続するセッションの間隔:** 「移動時間」から「移動時間 + 10分」に変えました。同じ会場でも、終了と同時に次が始まる組み合わせは成立しません（これまでは成立していました）。対象は、`travel-blocks` の不足判定、`schedule_optimize` の組み合わせ判定、おすすめ（`recommend`）の重なり判定、`now` と `detour` の収まり判定です。個人予定との間には、重ならなければよいとしています（会場も席の取り置きもないため）。
- **最低空き時間（`minGapMinutes`）との関係:** 大きい方を要求します。`relaxed`（30分）と `normal`（15分）は、同じ会場ではこれまでと変わりません。別会場の組み合わせは厳しくなります。
- **`considerTravelTime: false` のとき:** 到着の余裕も見込みません（移動時間を考慮しない指定を尊重するため）。
- **移動時間ブロックの長さ:** 変えていません。ブロックは必要な移動時間だけを埋め、余裕の10分は空けておきます。
- **`now` の満席表示:** 本体から外さず、別枠（`queue`）に出します。現地の列に並べば入れる場合がある、という公式の案内に沿った扱いです。席は保証されないので、注記を付けます。
- **確認できていないこと:** 列に並ぶときに、開始の何分前から並ぶべきか。移動時間の表（`travelTime.ts`）は、これまでどおり推測値です。2026-10-14 時点のあなたの予約 10 件には、この規則に当たる箇所はありませんでした。

## 13. 開発中の計画書について

実装中は、AI エージェント向けの、手順ごとの実装計画書を使っていました。ステップごとのコード片が大半で、読み物としては長いため、公開用には、この文書にまとめました。元の計画書は、公開リポジトリには含めていません。
