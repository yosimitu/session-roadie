# Session Roadie (nickname: re:Roadie)

English | [日本語](README.md)

**A backstage agent that keeps the official app in order for you. All you do is open the official app.**

Based on an attendee's intent and profile, re:Roadie uses the [AWS Events API](https://docs.aws.amazon.com/events/latest/devguide/what-is-events-api.html) to plan sessions, reserve seats, block travel time, and follow catalog changes, then **writes the result back to your personal schedule in the official app**. It is a local CLI agent.

It has no UI that replaces the official app (the idea is that at the venue you only need to look at the official app). It can only produce a read-only local HTML page (`re-roadie view`) for reviewing your schedule on a PC. See [docs/design.md](docs/design.md) (in Japanese) for the design and the record of tests against the real API.

### Screen sample

A sample of the HTML that `re-roadie view` writes. All sessions, reservations, and personal time are fictional, and no official catalog data is included. The travel blocks and warnings come from the real calculation logic.

The Schedule tab (day timeline with travel blocks, lunch-overlap warnings, and a full-session mark), and the Session list tab (recommended order, with scores and reasons).

[![The Schedule tab of re-roadie view (sample)](docs/sample/schedule-sample.en.png)](docs/sample/schedule-sample.en.png)
[![The Session list tab of re-roadie view (sample)](docs/sample/schedule-sample-list.en.png)](docs/sample/schedule-sample-list.en.png)

- Interactive sample: [English](docs/sample/schedule-sample.en.html) / [日本語](docs/sample/schedule-sample.html) (download and open in a browser; about 85 KB each, no network access)
- The English page comes from `re-roadie view --lang en`.
- To regenerate: `npx tsx scripts/generate-sample-html.ts` (writes both languages)

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

## Updating

From the repository root, run:

```bash
git pull
npm install
npm run build
```

What runs is the code in `dist/`, so skipping `npm run build` leaves the old version in place. Then, depending on how you use it:

| How you use it | What to do after updating |
| --- | --- |
| From Claude Code (MCP) | Restart Claude Code. A running server keeps the old code and cannot use new tools |
| Running `watch` on a schedule | Nothing. The next run uses the new `dist/` |
| Using the CLI directly | Nothing; it works as is |

- Everything under `data/` (your sign-in in `data/token.json`, profile, notes, catalog snapshots, and so on) is covered by `.gitignore`, so `git pull` does not overwrite it. You normally do not need to sign in again.
- If `git pull` fails, a file you edited locally is the cause. Check with `git status` and set aside changes you want to keep with `git stash`.
- If the build fails, your Node.js may be older than 22. Check with `node -v`.
- If you installed from a zip, `git pull` is not available. Extract the new zip to a separate folder, copy your `data/` into it, and run `npm install && npm run build`.
- To go back to an earlier version, find the commit with `git log`, run `git checkout <commit>`, and rebuild.

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
| `re-roadie sync` | Fetches the whole catalog and shows the diff (new, changed, cancelled) against the previous local snapshot.<ul><li>Each fetch saves that day's snapshot</li></ul><b>Options</b><ul><li>`--since YYYY-MM-DD`: compares against any saved past date (e.g. `--since 2026-09-24` shows what is new in the last week)</li></ul> |
| `re-roadie schedule` | Shows the current schedule (reservations, favorites, personal time). |
| `re-roadie view` | Writes the current schedule and the whole catalog to a single tabbed HTML file (default `data/schedule.html`). Read-only; it does not change your official schedule.<ul><li>Tabs: "Schedule", "Session list", "Overview", "Note candidates", "Update history"</li><li>The Schedule tab warns about overlaps, overlaps with personal time, insufficient travel time, and sessions that overlap lunch</li><li>The session list has a "recommended" sort and mark (computed at generation time without an LLM)</li><li>No external scripts or styles are loaded</li><li>About 2.7 MB because it embeds the whole catalog (it grows with the number of "Update history" periods). Not committed (`data/*.html` is ignored)</li><li>Details of each tab: `re-roadie view --help`</li></ul><b>Options</b><ul><li>`--date YYYY-MM-DD`: limits the Schedule tab to that day</li><li>`--new-since YYYY-MM-DD`: baseline for "new" (default: the latest per-day snapshot before today)</li><li>`--lang en`: switches the page to English (catalog titles and abstracts stay in the original; the English-to-Japanese translate buttons exist only in the Japanese page)</li><li>`--out`: output path</li></ul> |
| `re-roadie digest` | Compares saved daily snapshots day to day and writes a catalog update history (new, removed, and venue/room/time changes) as an HTML file (default `data/digest.html`, not committed).<ul><li>Uses no network</li><li>A period that spans days without a snapshot is labeled as merged</li><li>Snapshots are saved by `sync` and `watch`</li></ul><b>Options</b><ul><li>`--since YYYY-MM-DD`: limits it to that day onward</li><li>`-o`: output path</li></ul> |
| `re-roadie apply <desiredStateFile>` | Compares the desired state (session IDs to reserve or favorite) with the actual schedule and runs only the diff.<ul><li>Shows the operations and asks for confirmation before running</li><li>When something changes, saves the reservations and favorites from before the run to `data/schedule-backup-<eventId>-<timestamp>.json`</li><li>Always re-checks with `GetSchedule` afterwards</li></ul><b>Options</b><ul><li>`-y`, `--yes`: skips the confirmation prompt</li></ul> |
| `re-roadie watch` | Fetches the catalog and reports what changed since the last check (it never reserves). It covers the seat display of favorites that were full and of their repeats, new sessions that match your profile (attendance days, preferred level, sponsored-session exclusion, topics of interest), and venue/time changes and cancellations of your reservations and favorites.<ul><li>The first run only saves a baseline and does not notify</li><li>The state is not updated when the catalog returns 0 sessions or the fetched count is under half of the previous one</li><li>A changed seat display does not guarantee you can reserve (a session can be full even when it shows `limited`)</li><li>With `--notify`, another notification gives the count of new sessions (whether or not they match your profile) and the top 3 (profile matches first, sponsored last)</li><li>Each run saves that day's catalog as a daily snapshot (`data/catalog-<eventId>-YYYY-MM-DD.json`, about 3 MB; overwritten within a day) and regenerates `data/digest.html` (a write failure does not stop notifications). As a result, a bare `sync` compares against the latest `watch` fetch</li><li>State is kept in `data/watch-state-<eventId>.json` (not committed). It is shared with the MCP `catalog_watch`, so use only one of them</li></ul><b>Options</b><ul><li>`--interval 10`: repeats every given number of minutes (integer, 5 or more); runs once if omitted</li><li>`--notify`: also shows a desktop notification (macOS and Windows; console output only elsewhere)</li></ul> |
| `re-roadie now` | Lists sessions you can still make right now (it never reserves).<ul><li>A session qualifies when it starts after "now + travel time from where you are", within `--within` minutes, does not overlap your reservations or personal time, and is not shown as full. Ordered by favorites, topics of interest, then seat availability</li><li>Because you must reach the room 10 minutes before the start, the "in time" check adds 10 minutes to the travel time</li><li>Sessions shown as full are listed under a separate heading. Per the official FAQ, each session holds back some seats for walk-up attendees, so you may get in by joining the queue on site (a seat is not guaranteed)</li><li>Formats that cannot be reserved (`isReservable` is false) are noted</li><li>`walkUp` is presumably a queue-on-the-day format, which is unconfirmed</li></ul><b>Options</b><ul><li>`--within <minutes>`: only sessions starting within this many minutes (default 90)</li><li>`--venue <venue>`: where you are (default: the venue of the reservation in progress or just ended)</li><li>`--at "2026-12-02 10:30"`: venue local time, to try it outside the event</li><li>`--limit <n>`: number of results (default 10)</li></ul> |
| `re-roadie forecast` | From the history of seat displays, shows sessions likely to fill soon, quiet hidden gems in your topics of interest, and sessions whose seats are increasing (it never reserves).<ul><li>`sync` and `watch` build the history daily (`data/seat-history-<eventId>.json` plus the dated snapshots)</li><li>It is an estimate that assumes the recent pace of change continues, not a seat count</li><li>With less than two days of history no forecast is made, and confidence stays `low` while observations are few</li></ul><b>Options</b><ul><li>`--horizon <days>`: shows sessions expected to fill within this many days (default 14)</li><li>`--limit <n>`: results per section (default 10)</li></ul> |
| `re-roadie detour` | Suggests "detours" that fit between your reservations, per day (it never reserves).<ul><li>Sessions are ordered by a small interest strength (declared interest = 3, each reservation = 2, each favorite = 1, summed per topic), and only those at 3 or below are shown</li><li>They must not overlap your reservations or personal time, leave room for travel, not be full, and satisfy your profile's level, sponsored-session, and start-time settings</li><li>It is deterministic: the same input gives the same result</li></ul><b>Options</b><ul><li>`-d`, `--date <dates...>`: days to cover (several allowed; default: days with reservations)</li><li>`--per-day <n>`: candidates per day (default 3)</li></ul> |
| `re-roadie trends` | Shows trends in the catalog: counts and shares by topic, service, type, level, and day; the change since a baseline date; services that grew; terms that grew in titles; counts for words you pass; and the topics where your reservations and favorites are over- or under-represented compared with the whole catalog.<ul><li>Counts are numbers of listed sessions, not a measure of AWS's focus or of attendance (a session can appear simply by going from private to public)</li><li>Words are counted only when they appear in the title</li><li>It works without signing in, minus the personal comparison</li></ul><b>Options</b><ul><li>`--since YYYY-MM-DD`: baseline date (default: the oldest saved snapshot)</li><li>`--keyword AgentCore Kiro`: words to count (several allowed)</li><li>`--limit <n>`: results per section (default 10)</li></ul> |
| `re-roadie conflicts` | Detects time overlaps among reserved sessions and suggests which ones you can give up.<ul><li>Gives fact-based reasons (whether a repeat or a similar session exists)</li><li>Also shows reservations that overlap personal time (keynotes etc.)</li></ul> |
| `re-roadie travel-blocks` | Calculates travel time between reserved sessions. If you cannot make it in time it warns you; otherwise it writes the travel time to the official schedule with `CreatePersonalTime`.<ul><li>A reserved seat is released to walk-up attendees unless you reach the room at least 10 minutes before the start, so the check adds 10 minutes to the travel time (back-to-back sessions in the same venue also count as short)</li><li>The block covers only the required travel time (rounded up to 5 minutes), starting right after the previous session ends, not the whole gap</li></ul><b>Options</b><ul><li>`-y`, `--yes`: skips the confirmation prompt</li></ul> |
| `re-roadie notes add/list/report/apply` | Records and lists notes on sessions, produces a by-theme post-trip report, and writes day-of reminders.<br><b>Options</b><ul><li>`-y`, `--yes` on `notes apply`: skips the confirmation prompt</li></ul> |
| `re-roadie auth login` | Signs in to Builder ID in the browser. |
| `re-roadie auth status` | Shows the sign-in state. |
| `re-roadie auth logout` | Signs out.<ul><li>Revokes the refresh token, deletes the local token, and ends the Builder ID browser session</li></ul> |

Every command also takes `-e, --event-id <eventId>` (default `reinvent2026`). `--help` on each command lists the conditions and caveats of how it works.

`re-roadie` is an alias for `node dist/cli.js`. After `npm run build`, run it from the repository root as `node dist/cli.js <subcommand>` (or `npx re-roadie <subcommand>`). To call plain `re-roadie`, run `npm link` in the root.

### Using it from Claude Code (MCP server)

Besides the CLI, `re-roadie mcp` starts an MCP server (stdio). When you open this project in Claude Code, the `session-roadie` server registered in `.mcp.json` and `.claude/skills/re-roadie/SKILL.md` (a procedure that defines the order in which MCP tools are called) become available automatically.

```
Claude Code → skill/commands (procedure only) → re:Roadie (all the logic) → AWS Events REST API
```

- All logic (diff calculation, idempotent reconciliation, travel-time calculation, quota control, alternative detection) lives in re:Roadie. The skill only defines the order of calls.
- MCP tool failures are returned as JSON of the form `{kind, status, operation, message, hint, body}` with `isError: true`. `schedule_apply` runs reserve, favorite, cancel, and unfavorite independently; if one step fails, it continues with the rest and returns a per-step result (`ok`/`error`/`skipped`). Only on an authentication failure (401) does it stop and skip the remaining steps.
- Write tools (`schedule_apply`/`travel_blocks_apply`/`notes_reminders_apply`) have no confirmation prompt and run immediately when called. Confirmation is the caller's job (Claude via the skill), after showing the diff with the `*_plan` tools.

#### Using it behind a corporate proxy

If your network only reaches the internet through a proxy, the MCP server's requests do not go through it and the connection fails, because Node.js `fetch` does not read the proxy environment variables by default. Set them in the `env` of `.mcp.json` (replace `proxy.example.com:8080` with your proxy):

```json
{
  "mcpServers": {
    "session-roadie": {
      "command": "node",
      "args": ["dist/cli.js", "mcp"],
      "env": {
        "NODE_USE_ENV_PROXY": "1",
        "HTTPS_PROXY": "http://proxy.example.com:8080",
        "HTTP_PROXY": "http://proxy.example.com:8080",
        "NO_PROXY": "localhost,127.0.0.1"
      }
    }
  }
}
```

- `NODE_USE_ENV_PROXY=1` makes `fetch` read `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`. It works on Node.js 24 and later, and on newer 22.x releases (22.21 or later). On an older 22.x, update Node.js.
- Keep `localhost,127.0.0.1` in `NO_PROXY`. The Builder ID sign-in receives its result on `127.0.0.1` (ports 8484 to 8489).
- If the proxy requires authentication, put it in the URL as `http://user:password@proxy.example.com:8080`. Do not commit a password in `.mcp.json`.
- If the proxy inspects traffic with a corporate certificate and you get certificate errors, add `"NODE_EXTRA_CA_CERTS": "/path/to/company-ca.pem"` to `env`.
- When you run the CLI directly (for example `re-roadie sync`), set the same variables in your shell (`export` on macOS, `$env:` in PowerShell).

#### MCP tools ([src/mcp/server.ts](src/mcp/server.ts), 25 tools)

| Tool | Description |
| --- | --- |
| `auth_status` | Checks the Builder ID sign-in state. If the access token has expired but can be renewed with the refresh token, it returns signed in (`refreshed: true`) |
| `auth_login` | Opens the browser and signs in to Builder ID (waits for you to finish in the browser) |
| `auth_logout` | Signs out (revokes the refresh token, deletes the local token, and ends the Builder ID browser session) |
| `catalog_sync` | Fetches the whole catalog and returns the diff (new, changed, cancelled) against the local snapshot. `since` compares against any past date |
| `catalog_watch` | Fetches the catalog and returns, once, what changed since the last check (seat display of full favorites and their repeats, new sessions matching your profile, changes and cancellations of your reservations and favorites). The first run only saves a baseline. It never reserves |
| `sessions_now` | Returns the sessions you can make right now (`items`) and the sessions shown as full that you could try by joining the queue on site (`queue`) (same as the CLI `now`; accepts `at`, `venue`, `withinMinutes`, `limit`). It never reserves |
| `seat_forecast` | From the seat-display history, returns sessions likely to fill soon (`urgent`), hidden gems (`hidden`), and sessions with increasing seats (`freeing`). An estimate, not a seat count. It never reserves |
| `detour_suggest` | Returns detours that fit between your reservations, per day (accepts `dates`, `perDay`). It never reserves |
| `catalog_trends` | Returns the catalog trends (same as the CLI `trends`; accepts `since`, `keywords`, `limit`). Counts are listed sessions, not a measure of focus |
| `catalog_search` | Filters sessions from the local snapshot (keyword, topic, format, level, date, venue, service). Also returns the IDs of other occurrences (repeats). If you omit the date, `maxLevel`, or `excludeSponsored`, it filters by profile values (attendance days, preferred level, sponsored exclusion) and returns the applied values in `appliedProfileDefaults` |
| `profile_get` | Returns the saved profile and intent, and the `schedule_optimize` defaults derived from them |
| `schedule_optimize` | From candidate sessions, picks the largest non-overlapping combination, taking into account swapping to repeats, personal time, travel time between venues, and the profile (daily limit, minimum gap, preferred formats, attendance days, earliest start time, fixed appointments; lunch is a warning only). It does not execute anything. Candidates that did not fit are returned with the sessions they conflict with |
| `schedule_get` | Gets the current schedule (reservations, favorites, personal time) |
| `schedule_view` | Writes the same HTML as `re-roadie view` to `data/schedule.html` (read-only; the output path is fixed; `date`, `newSince`, and `lang` (`ja`/`en`) can be given) |
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
- It defines only the order in which the 25 MCP tools are called and holds no logic. It states the basic rule that write operations always show the diff with `*_plan`, get the user's confirmation, and only then call `*_apply`.
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
| Know when seats open, or what is new | 「満席のものが空いたら教えて」(tell me when full sessions open up), 「新しいセッションは？」(anything new?), 「予定が変わっていない？」(did my schedule change?) |
| Find what I can make right now | 「いまから行けるセッションは？」(what can I go to now?), 「次の予定まで1時間あるけど、何か聞ける？」(I have an hour before my next session; anything to attend?) |
| Secure what is about to fill up | 「満席になりそうなセッションは？」(which sessions are about to fill?), 「穴場はある？」(any hidden gems?) |
| Add something different between sessions | 「寄り道できるセッションを探して」(find me a detour session) |
| Understand the overall picture | 「今年は何が多い？」(what is most common this year?), 「前より増えた話題は？」(which topics grew?), 「AgentCore と Kiro は何件ある？」(how many sessions mention AgentCore and Kiro?), 「自分の関心は全体と比べてどう？」(how do my interests compare with the whole?) |

Free-form text is fine for all of these; you do not need to give session IDs or tool names (Claude interprets the intent and proceeds as `*_plan` diff, confirmation, `*_apply`). More examples are in the [Appendix: Useful phrases](#appendix-useful-phrases).

## Example: from preparation to the event

An attendee who wants to focus on Lambda and serverless talks to Claude Code. Claude's replies are illustrative, not literal output. The session names and IDs are real catalog entries.

### Preparation (first time)

> **You**: This is my first time attending. I want to focus on serverless. Onboard me.
>
> **Claude**: Asks for your attendance days, preferred levels, and whether to exclude sponsored sessions, then saves your profile.

> **You**: Are there any sessions about running web apps on Lambda?
>
> **Claude**: Finds "Build interactive web apps with AWS Lambda" (SVS327-R1, 12/2 09:00, chalk talk) and the same session as SVS327-R (12/3 13:30).

### Build the schedule

> **You**: Plan my 12/2 around serverless.
>
> **Claude**: Drafts a plan from the candidates, shows the diff (what it will newly reserve and cancel) and asks for confirmation. The plan has the form `{ "reserve": [...], "favorite": [...] }`.

> **You**: OK, apply it.
>
> **Claude**: Reserves the sessions and reports any failure with its reason (for example `sessionFull`). After applying, it re-reads your actual schedule and checks that no difference remains.

### Tidy the schedule

> **You**: Do any of my sessions overlap?
>
> **Claude**: Shows the overlapping reservations, with repeats and similar sessions as material for deciding which to drop.

> **You**: Block travel time.
>
> **Claude**: Between sessions at different venues, adds a personal-time block of only the minutes needed, starting right after the previous session ends.

> **You**: Add an Expo walk-through on 12/1 from 11:00 to 12:00.
>
> **Claude**: Registers it as a personal-time entry.

> **You**: Show me.
>
> **Claude**: Writes your schedule, the session list, and an overview to `data/schedule.html` (read-only).

### Every day: watch for seats, new sessions, and changes

Run `re-roadie watch` daily to be told about:
- a change in the seat display of a full favorite (or its repeat)
- new sessions that match your profile
- venue or time changes, and cancellations, of your reservations and favorites

When you see a report, ask:

> **You**: Reserve SVS327-R1.
>
> **Claude**: Shows the diff and reserves after you confirm. If the session is full, reports `sessionFull`.

A changed seat display does not guarantee a reservation. `watch` never reserves anything.

Notifications and the daily run differ by OS.

| OS | Notification | Daily run |
| --- | --- | --- |
| macOS | `--notify` shows a desktop notification | launchd |
| Windows | `--notify` shows a toast notification (it uses `powershell.exe`, i.e. Windows PowerShell 5.1) | Task Scheduler |

#### macOS (launchd)

Put the following in `~/Library/LaunchAgents/com.example.session-roadie-watch.plist`. Adjust the paths to `node` and `dist/cli.js`, and `WorkingDirectory`, to your environment.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.example.session-roadie-watch</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/path/to/session-roadie/dist/cli.js</string>
        <string>watch</string>
        <string>--notify</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/session-roadie</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/<user name>/Library/Logs/session-roadie-watch.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/<user name>/Library/Logs/session-roadie-watch.log</string>
</dict>
</plist>
```

Register it with `launchctl load ~/Library/LaunchAgents/com.example.session-roadie-watch.plist`. If the Mac is asleep at 9:00, the job runs after it wakes. If it is powered off, the job does not run.

#### Windows (Task Scheduler)

In PowerShell, adjust the repository root path to your environment and run the following. It has not been verified on a real Windows machine.

```powershell
$root = 'C:\path\to\session-roadie'
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $node -Argument 'dist\cli.js watch' -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At 9:00
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName 'session-roadie-watch' -Action $action -Trigger $trigger -Settings $settings
```

- `-StartWhenAvailable` runs the task after the PC wakes if it was not running at 9:00.
- To get notifications too, change `-Argument` to `'dist\cli.js watch --notify'`. The notification is a toast from `powershell.exe` (Windows PowerShell 5.1). It has not been verified on a real Windows machine.
- If nothing appears, check that Windows Focus Assist and the Notifications setting are not turning it off. A failed notification does not stop `watch`; it prints "通知に失敗しました".
- Without notifications, check new sessions and changes by opening `data/digest.html` or running `node dist/cli.js watch` by hand.

### At the event (December)

> **You**: What is on my schedule today?
>
> **Claude**: Lists your reservations, travel blocks, and notes in time order.

> **You**: Add a note to SVS327-R1: "try the Hono adapter".
>
> **You**: Write my post-trip report.
>
> **Claude**: Summarizes your notes and the sessions you attended.

Anything that changes your reservations or schedule shows a diff and asks for confirmation first. Example phrases, grouped by purpose, are in the [Appendix: Useful phrases](#appendix-useful-phrases).

## Current limitations

- **A changed seat display does not guarantee you can reserve.** A session can be full even when `seatAvailability` is `limited` or similar, and a full session is returned as `sessionFull` in `failed[].code`. `watch` only reports changes in the display and never reserves.
- **The travel-time table between venues ([src/schedule/travelTime.ts](src/schedule/travelTime.ts)) is not measured data.** It is an estimate based on distances read from positions on the official campus map (a schematic without scale; the scale is assumed to be about 1.2 miles between MGM Grand and Caesars Palace). Under 0.7 miles is walking (3 mph plus a flat 8 minutes; 15 minutes between the three venues Venetian, Wynn/Encore, and Forum by specification); 0.7 miles or more is by shuttle (20 minutes up to 1.2 miles, 30 minutes beyond). Shuttle schedules and stops have not been checked. Caesars Palace and Caesars Forum are treated as separate venues, and `Wynn/Encore` uses a distance that assumes the Encore side. Unknown venues are treated as 40 minutes.
- **PersonalTime date and time are calculated in fixed PST (UTC-8).**
- **PersonalTime date and times are written in the venue's local time (PST), not UTC.** The official app displays the stored value as is. Writing travel blocks and note reminders, the overlap checks against personal time, and the `re-roadie view` rendering all use this form. This differs from the "UTC" wording in the API documentation, so personal time written in UTC by another client may look shifted.
- **After you write with `CreatePersonalTime`, it takes a few minutes to over ten minutes for the content to appear in the official app's (smartphone) calendar.** The server-side data (what `GetSchedule` returns) is updated right away, but the app's client-side cache is not refreshed immediately.
- **The update history (`digest` and the `view` "Update history" tab) compares days that have a daily snapshot.** Snapshots are saved only on days when `sync` or `watch` runs, so a period spanning days without one is labeled as a combined diff, and sessions that were added and removed in between do not appear.
- **On Windows, the file permission (0600) on `data/token.json` and `data/schedule-backup-*.json` has no effect.** On macOS they are saved readable only by the owner, but on Windows the folder's permissions (ACL) apply as is. Do not keep the repository in a shared or synced folder.

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
| `re-roadie watch` | Reports seat displays that opened on full favorites, new sessions matching your profile, and changes and cancellations of your reservations and favorites (`--interval 10` repeats, `--notify` adds a desktop notification) |
| `re-roadie conflicts` | Detects overlaps among reserved sessions |
| `re-roadie init` | Profile questions (first-time setup, including priorities) |

### Tips

- Before any reservation or cancellation, the diff is always shown. It runs only when you answer "go ahead".
- The HTML is not regenerated automatically. After `catalog_sync` or a reservation change, ask "export my schedule as HTML" to refresh it (it is fixed to the contents at the moment of generation).
- `schedule_view` and the priority feature are not available if the running MCP server is an old version. Restart Claude Code and try again.

## License

MIT License. See [LICENSE](LICENSE).
