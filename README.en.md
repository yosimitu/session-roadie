# Session Roadie (nickname: re:Roadie)

English | [日本語](README.md)

**A backstage agent that keeps the official app in order for you. All you do is open the official app.**

Based on an attendee's intent and profile, re:Roadie uses the [AWS Events API](https://docs.aws.amazon.com/events/latest/devguide/what-is-events-api.html) to plan sessions, reserve seats, block travel time, and follow catalog changes, then **writes the result back to your personal schedule in the official app**. It is a local CLI agent.

It has no UI that replaces the official app (the idea is that at the venue you only need to look at the official app). It can only produce a read-only local HTML page (`re-roadie view`) for reviewing your schedule on a PC. See [docs/design.md](docs/design.md) (in Japanese) for the design and the record of tests against the real API.

> **Note**: This is an unofficial tool developed by an individual. It is not provided or endorsed by AWS or Amazon. It follows the official AWS Events API documentation, but use it at your own risk. It rewrites your reservations, favorites, and personal time, so always review the diff before running it.

## What this tool commits to

- **Respects the quotas.** `ListSessions`/`GetSession` 120 requests/min, `GetSchedule` 60/min, write operations 30/min ([src/api/quotas.ts](src/api/quotas.ts)). It retries `429` responses according to `Retry-After`.
- **Does not redistribute catalog data.** Session data is stored only under the local `data/` directory and is never committed (see `.gitignore`).
- **Keeps personal information local.** Profile, intent, and notes are never sent to the API. They are stored only in local files.
- **No hosting.** Everything runs on your own machine, signed in as yourself.

## Requirements

- Node.js 22 or later
- Git
- macOS / Windows

On Windows, install them with the LTS installer (`.msi`) from [nodejs.org](https://nodejs.org/) or with `winget`. Open a new terminal afterwards.

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
node -v
```

## Setup

```bash
git clone https://github.com/yosimitu/session-roadie.git
cd session-roadie
npm install
npm run build
```

Run all later commands from the repository root (`session-roadie`). `data/` is created relative to the current working directory.

## Usage

On first use, an interactive wizard creates a simple profile and intent, and you sign in with Builder ID. You do not need to write YAML by hand.

```bash
node dist/cli.js init
node dist/cli.js auth login
```

Besides your usual work, your goal for this trip, your stamina, your attendance days (first and last day), and your topics of interest, `init` asks about your preferred level, whether sponsored sessions are acceptable, the earliest start time, whether to warn about sessions that overlap lunch, and fixed appointments. Only the first three are required. The rest can be answered "undecided", "none", or "no limit". Your answers are reflected in the plan as follows. The mapping of numbers and formats is provisional and can be adjusted in [src/planning/preferences.ts](src/planning/preferences.ts).

| Answer | How it is used |
| --- | --- |
| Stamina | Daily session limit and minimum gap between sessions (`relaxed` = 3 sessions / 30 min, `normal` = 4 / 15 min, `packed` = no limit) |
| Goal | Session formats to prefer among combinations with the same number of sessions (`learning` = Workshop / Builders' session etc., `research` = Breakout / Lightning talk, `networking` = Chalk talk / Builders' session, `report` = Breakout) |
| Attendance days | Days targeted by optimization and search |
| Topics of interest | Converted to catalog topics and saved (Claude uses them as search conditions) |
| Priority of topics (optional; when you pick two or more, in order from first) | Decides the weights for **recommendations** in the session list, taking precedence over the trend in your favorites (1st = 1, last = 0.5, evenly spaced between). If omitted, the base weight is the number of times each topic appears in your favorites (proportional, most frequent = 1), with a floor of 0.5 for topics of interest |
| Preferred level (up to 200 / up to 300 / no limit) | Default filter for `catalog_search` (`maxLevel`). Sessions whose level cannot be read as a number are kept. Of 2,194 sessions, "up to 200" removes about 80% and "up to 300" about 20% (snapshot of 2026-10-08) |
| Sponsored sessions (include / avoid) | Default filter for `catalog_search` (`excludeSponsored`). Excludes sessions whose abbreviation ends with `-S` / `-S-R1` and those whose title contains `(sponsored by` |
| Earliest start time | `schedule_optimize` does not pick sessions that start earlier (venue local time) |
| Lunch warning (warn / don't warn) | `schedule_optimize` and `schedule_plan` report in `warnings` when a selected or to-be-reserved session overlaps 12:00-13:00. The session is not excluded (ending exactly at 12:00 or starting exactly at 13:00 is not a warning) |
| Fixed appointments (dinners, internal meetings, etc.) | `schedule_optimize` does not pick overlapping sessions. They are not written to the official app and are saved only in `profile.yaml` |

`auth login` opens the browser to the Builder ID sign-in page. After you sign in, the browser returns to one of `http://localhost:8484` to `8489`. The tool only listens locally; the port is not exposed externally.

### Main commands

| Command | Description |
| --- | --- |
| `re-roadie sync` | Fetches the whole catalog and shows the diff (new, changed, cancelled) against the previous local snapshot. `--since YYYY-MM-DD` compares against any past date (e.g. `--since 2026-09-24` shows what is new in the last week) |
| `re-roadie schedule` | Shows the current schedule (reservations, favorites, personal time) |
| `re-roadie view` | Writes the current schedule and the whole catalog to a single tabbed HTML file (default `data/schedule.html`). **Read-only**; it does not change your official schedule. Tabs: "Schedule" (day-by-day timeline, switchable to a five-day side-by-side view; shows reservations, personal time such as keynotes, travel blocks, unreserved favorites and seat availability, and warns about overlaps, overlaps with personal time, insufficient travel time, and sessions that overlap lunch; unchecking "show unreserved favorites" leaves only reservations and personal time; colored bands in the background mark 7-8 breakfast, 12-13 lunch, and evening from 18:00 as a rough guide; clicking a card jumps to that session's details in the list; ★ notes added in the list appear in a column on the right and warn about overlaps with reservations and personal time), "Session list" (filter and search all sessions; marks for reserved, official favorites, new, and seat availability; tags in Japanese, titles and abstracts via Chrome's built-in translation), "Overview" (counts), and "Note candidates" (in-browser notes added with ☆; overlaps in red, ★ to remove, jump to the list's details, CSV export; not reflected in the official schedule, reservations, or re:Roadie). The session list has a "recommended" sort and mark, showing a score (0-100), reasons, and the basis (where the topic weights come from). Scores are computed at generation time without an LLM, not in the browser, and sessions that violate conditions such as reservations, personal time, travel time, seat availability, preferred level, sponsored-session exclusion, and attendance days are excluded ([src/planning/recommend.ts](src/planning/recommend.ts)). `--date YYYY-MM-DD` limits the Schedule tab to that day, `--new-since YYYY-MM-DD` sets the baseline for "new" (default: the latest per-day snapshot before today), and `--out` changes the output path. No external scripts or styles are loaded. The file is about 2.6 MB because it embeds the whole catalog, so it is not committed (`data/*.html` is ignored) |
| `re-roadie apply <desiredStateFile>` | Compares the desired state (session IDs to reserve or favorite) with the actual schedule and runs only the diff. It shows the operations and asks for confirmation before running, and always re-checks with `GetSchedule` afterwards |
| `re-roadie conflicts` | Detects time overlaps among reserved sessions and suggests which ones you can give up, with fact-based reasons (whether a repeat or a similar session exists). It also shows reservations that overlap personal time (keynotes etc.) |
| `re-roadie travel-blocks` | Calculates travel time between reserved sessions. If you cannot make it in time it warns you; otherwise it writes the travel time to the official schedule (the block covers only the required travel time, rounded up to 5 minutes, starting right after the previous session ends, not the whole gap) with `CreatePersonalTime` |
| `re-roadie notes add/list/report/apply` | Records and lists notes on sessions, produces a by-theme post-trip report, and writes day-of reminders |
| `re-roadie auth login` | Signs in to Builder ID in the browser |
| `re-roadie auth status` | Shows the sign-in state |

### Using it from Claude Code (MCP server)

Besides the CLI, `re-roadie mcp` starts an MCP server (stdio). When you open this project in Claude Code, the `session-roadie` server registered in `.mcp.json` and `.claude/skills/re-roadie/SKILL.md` (a procedure that defines the order in which MCP tools are called) become available automatically.

```
Claude Code → skill/commands (procedure only) → re:Roadie (all the logic) → AWS Events REST API
```

- All logic (diff calculation, idempotent reconciliation, travel-time calculation, quota control, alternative detection) lives in re:Roadie. The skill only defines the order of calls.
- MCP tool failures are returned as JSON of the form `{kind, status, operation, message, hint, body}` with `isError: true`. `schedule_apply` runs reserve, favorite, cancel, and unfavorite independently; if one step fails, it continues with the rest and returns a per-step result (`ok`/`error`/`skipped`). Only on an authentication failure (401) does it stop and skip the remaining steps.
- Write tools (`schedule_apply`/`travel_blocks_apply`/`notes_reminders_apply`) have no confirmation prompt and run immediately when called. Confirmation is the caller's job (Claude via the skill), after showing the diff with the `*_plan` tools.

#### MCP tools ([src/mcp/server.ts](src/mcp/server.ts), 20 tools)

| Tool | Description |
| --- | --- |
| `auth_status` | Checks the Builder ID sign-in state. If the access token has expired but can be renewed with the refresh token, it returns signed in (`refreshed: true`) |
| `auth_login` | Opens the browser and signs in to Builder ID (waits for you to finish in the browser) |
| `auth_logout` | Signs out (revokes the refresh token, deletes the local token, and ends the Builder ID browser session) |
| `catalog_sync` | Fetches the whole catalog and returns the diff (new, changed, cancelled) against the local snapshot. `since` compares against any past date |
| `catalog_search` | Filters sessions from the local snapshot (keyword, topic, format, level, date, venue, service). Also returns the IDs of other occurrences (repeats). If you omit the date, `maxLevel`, or `excludeSponsored`, it filters by profile values (attendance days, preferred level, sponsored exclusion) and returns the applied values in `appliedProfileDefaults` |
| `profile_get` | Returns the saved profile and intent, and the `schedule_optimize` defaults derived from them |
| `schedule_optimize` | From candidate sessions, picks the largest non-overlapping combination, taking into account swapping to repeats, personal time, travel time between venues, and the profile (daily limit, minimum gap, preferred formats, attendance days, earliest start time, fixed appointments; lunch is a warning only). It does not execute anything. Candidates that did not fit are returned with the sessions they conflict with |
| `schedule_get` | Gets the current schedule (reservations, favorites, personal time) |
| `schedule_view` | Writes the same HTML as `re-roadie view` to `data/schedule.html` (read-only; the output path is fixed; `date` and `newSince` can be given) |
| `schedule_plan` | Calculates the diff between the desired state (session IDs to reserve or favorite) and the actual schedule. It does not execute anything. A side you omit stays as is |
| `schedule_apply` | Actually executes the desired state. It re-fetches `GetSchedule` automatically afterwards and returns any remaining diff as well |
| `conflicts_get` | Detects time overlaps among reserved sessions and proposes which to give up first, with fact-based reasons (whether a repeat or similar session exists). Also returns reservations that overlap personal time (keynotes etc.) |
| `travel_blocks_plan` | Calculates travel time between reserved sessions (does not execute). Returns a warning if you cannot make it in time |
| `travel_blocks_apply` | Actually writes the secured travel-time blocks to the official schedule with `CreatePersonalTime` |
| `notes_list` | Returns the saved notes |
| `notes_add` | Adds a note to a session (overwrites an existing note) |
| `notes_report` | Returns a by-theme post-trip report of the notes as Markdown |
| `notes_reminders_plan` | Calculates reminder candidates to show just before sessions that have notes (does not execute) |
| `notes_reminders_apply` | Actually writes note reminders to the official schedule with `CreatePersonalTime` |
| `onboarding_save` | For first-time attendees. Saves the initial profile and intent from the answers to the questions (usual work / goal / stamina are required; attendance days, topics of interest, preferred level, sponsored sessions, earliest start time, lunch, and fixed appointments are optional) |

#### Skill ([.claude/skills/re-roadie/SKILL.md](.claude/skills/re-roadie/SKILL.md))

- **name**: `re-roadie`
- **Example triggers** (the skill is written for Japanese prompts): "re:Invent の予定を整えて" (organize my re:Invent schedule), "今日の予定を組んで" (plan today), "移動時間を確保して" (block travel time), "メモをリマインダーにして" (turn my notes into reminders)
- It defines only the order in which the 20 MCP tools are called and holds no logic. It states the basic rule that write operations always show the diff with `*_plan`, get the user's confirmation, and only then call `*_apply`.
- Catalog session information (title, abstract, etc.) is English only, so the skill also includes a rule to show a Japanese translation and a short description to the user.

#### What to say (examples by goal)

The skill is written for Japanese, so the example prompts below are in Japanese, with an English gloss.

| Goal | Example prompts |
| --- | --- |
| First time attending and not sure how to spend it | 「初めて参加するので、どう過ごせばいいか分からない」(I'm new and don't know how to spend my time), 「オンボーディングして」(onboard me) |
| Plan a schedule / reserve sessions | 「今日の予定を組んで」(plan today), 「セッションを予約して」(reserve sessions), 「〇〇中心に予定を組んで」(plan around a topic) |
| Resolve conflicts (time overlaps) | 「競合を解消したい」(resolve conflicts), 「どれを諦めればいい？」(which should I give up?) |
| Block travel time | 「移動時間を確保して」(block travel time) |
| Leave a note on a session / make it a day-of reminder | 「メモを残して」(leave a note), 「当日リマインダーにして」(make it a day-of reminder) |
| Create a post-trip report | 「帰国後の報告を作って」(write my post-trip report) |

Free-form text is fine for all of these; you do not need to give session IDs or tool names (Claude interprets the intent and proceeds as `*_plan` diff, confirmation, `*_apply`). More examples are in the [Appendix: Useful phrases](#appendix-useful-phrases).

## Current limitations

- **`ReserveSessions` was rejected with HTTP 409 "This operation is currently disabled" on the opening day (2026-10-08), but worked on 2026-10-11 and one reservation succeeded.** Cancelling that reservation (`CancelReservation`) also succeeded the same day (the post-apply `GetSchedule` check matched in both cases). A full session is returned as `sessionFull` in `failed[].code`. Even when `seatAvailability` is `limited` or similar, a session can be full, so the seat display does not guarantee that a reservation will succeed.
- **The travel-time table between venues ([src/schedule/travelTime.ts](src/schedule/travelTime.ts)) is not measured data.** It is an estimate based on distances read from positions on the official campus map (a schematic without scale; the scale is assumed to be about 1.2 miles between MGM Grand and Caesars Palace). Under 0.7 miles is walking (3 mph plus a flat 8 minutes; 15 minutes between the three venues Venetian, Wynn/Encore, and Forum by specification); 0.7 miles or more is by shuttle (20 minutes up to 1.2 miles, 30 minutes beyond). Shuttle schedules and stops have not been checked. Caesars Palace and Caesars Forum are treated as separate venues, and `Wynn/Encore` uses a distance that assumes the Encore side. Unknown venues are treated as 40 minutes.
- **PersonalTime date and time are calculated in fixed PST (UTC-8).** This is backed by the real `GetEvent` data (ISO 8601 offsets in `startDate`/`endDate`).
- **PersonalTime date and times are written in the venue's local time (PST), not UTC.** Confirmed on the real app on 2026-10-11: the official app displays the stored value as is (personal time such as keynotes is stored in the same form, and a personal time written by re:Roadie in local time, "Expo会場めぐり" on 12/1 11:00-12:00, was shown at 11:00-12:00 in the app). Writing travel blocks and note reminders, the overlap checks against personal time, and the `re-roadie view` rendering all use this form. This differs from the "UTC" wording in the API documentation, so personal time written in UTC by another client may look shifted.
- **After you write with `CreatePersonalTime`, it takes a few minutes to over ten minutes for the content to appear in the official app's (smartphone) calendar** (confirmed on the real device on 2026-10-01). The server-side data (what `GetSchedule` returns) is updated correctly right away, but the app's client-side cache is not refreshed immediately.

## Tests

```bash
npm test
```

## Architecture overview

```
src/
  api/        AWS Events API types, quota management, HTTP client
  auth/       Builder ID OAuth (PKCE) sign-in, automatic token refresh and local storage
  profile/    Local stores for profile, intent, and notes
  catalog/    Full catalog fetch, snapshot storage, diff detection, filtered search
  schedule/   Reconciliation logic, write wrappers, travel-time blocks, personal-time overlap detection
  planning/   Alternative detection (repeats, similar sessions), selection of the largest non-overlapping combination
  reporting/  Post-trip report generation and schedule HTML output (scheduleHtml.ts: assembly, catalogRecords.ts: catalog records, catalogClient.ts: in-browser script, jaLabels.ts: Japanese tag dictionary; read-only)
  onboarding/ Logic of the interactive wizard for first-time attendees
  commands/   Actual processing shared by CLI and MCP (separated as testable pure functions)
  mcp/        MCP server (tools.ts has the handlers, server.ts registers them with McpServer)
  runtimeContext.ts  Settings shared by CLI and MCP (data directory, ApiClient creation)
  cli.ts      CLI entry point using commander (command name: `re-roadie`; `re-roadie mcp` starts the MCP server)
```

## Appendix: Useful phrases

Example prompts for Claude Code. Free-form text is fine for all of them, with no need for session IDs or tool names. Changes to reservations, cancellations, and favorites are always executed only after the diff is shown and you confirm. The prompts are in Japanese, with an English gloss.

### Check the current state

- 「最新のセッション情報を取って」(fetch the latest session info; `catalog_sync`, returns new/changed/removed)
- 「11/30 の午前で予約しているセッションは？」(what have I reserved for the morning of 11/30?)
- 「予約が取れているか確認して」(check whether my reservations went through)
- 「競合している予定はある？ どれを諦めればいい？」(are there conflicts? which should I give up?)

### Search and get recommendations

- 「Agentic AI の Workshop で、満席でないものを探して」(find Agentic AI workshops that are not full)
- 「11/30 の午前で、おすすめはある？」(any recommendations for the morning of 11/30? Takes seats, reservations, and travel time into account)
- 「セキュリティ系で、新しく出たセッションは？」(any new security sessions?)
- 「満席だったので、他にない？」(it was full, any alternatives?)
- 「おすすめの基準を教えて」(explain the recommendation criteria; explains where the topic weights come from)

### Plan and reserve

- 「今日の予定を組んで」(plan today), 「セッションを予約して」(reserve sessions)
- 「余裕を持った予定で、セキュリティ中心に組んで」(plan a relaxed schedule centered on security)
- 「候補の中から、重ならない組み合わせを選んで」(pick a non-overlapping combination from the candidates; `schedule_optimize`)
- 「この1件を予約して」(reserve this one; shows the diff, then asks for confirmation)

### Travel and notes

- 「移動時間を確保して」(block travel time)
- 「このセッションにメモを残して」(leave a note on this session), 「メモを当日のリマインダーにして」(turn the notes into day-of reminders)
- 「帰国後の報告を作って」(write my post-trip report)

### View as HTML (read-only)

- 「予定を HTML で出して」(export my schedule as HTML), 「今日の予定を PC で見たい」(I want to see today's schedule on my PC; `schedule_view`)
- 「新着を HTML で確認したい」(I want to check what's new in HTML; `newSince` sets the baseline date)

### Adjust your profile

- 「関心テーマの優先順位を、セキュリティ、AI、移行の順にして」(set topic priority to security, AI, migration; changes the recommendation weights)
- 「スポンサーセッションは避けたい」(avoid sponsored sessions), 「レベルは 300 までにして」(limit to level 300)
- 「朝 9 時より前は避けたい」(avoid anything before 9 AM), 「昼にかかる回は警告して」(warn about sessions that overlap lunch)
- 「12/1 の 18:00〜20:00 は会食で空けて」(keep 12/1 18:00-20:00 free for a dinner)

### Run directly from the command line (without Claude)

| Command | Description |
| --- | --- |
| `re-roadie sync` | Gets the catalog diff |
| `re-roadie view` | Writes the schedule and catalog to a single HTML file (`--date`, `--new-since`, and `--out` are available) |
| `re-roadie schedule` | Lists reservations, favorites, and personal time |
| `re-roadie conflicts` | Detects overlaps among reserved sessions |
| `re-roadie init` | Profile questions (first-time setup, including priorities) |

### Tips

- Before any reservation or cancellation, the diff is always shown. It runs only when you answer "go ahead".
- The HTML is not regenerated automatically. After `catalog_sync` or a reservation change, ask "export my schedule as HTML" to refresh it (it is fixed to the contents at the moment of generation).
- `schedule_view` and the priority feature are not available if the running MCP server is an old version. Restart Claude Code and try again.

## License

MIT License. See [LICENSE](LICENSE).
