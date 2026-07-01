# Admin Usage Dashboard

Central, manager-facing dashboard that aggregates token consumption and estimated **API cost** across all registered developers. It is a standalone web page served by the coordination server (not a webview), reachable in a browser by an admin who logs in with a username/password.

Cost is computed as **raw token counts x API price**, per model and per token type. There is no "percentage of quota" concept. Costs are **API costs only** (not subscription/plan costs), with a single uniform price list for the whole team, editable in the admin UI.

Companion manager-facing spec (Hebrew): `Kingdom_of_Claudes_Beloved_MDs/ADMIN_USAGE_DASHBOARD_SPEC_HE.html`.

---

## Architecture

```
[ Extension client ]              [ Coordination server ]                 [ Admin browser ]
DeveloperUsageReporter --HTTP-->  HTTP layer (UsageHttpServer):           GET /admin (static SPA)
  - per-model/type counts           POST /api/usage/register  -> UsageStore  - cookie/JWT login
  - hourly timer                     POST /api/usage/report    -> UsageStore  - KPIs, leaderboard,
  - consent gate                     POST /api/admin/login     -> AdminAuth     charts, alerts,
  - delta + last-report state        GET  /api/admin/summary   -> aggregate     price settings
                                     GET/PUT /api/admin/prices -> UsageStore
                                     GET  /api/admin/developer -> aggregate (drill-down)
                                     serves /admin static SPA
                                   (existing WebSocket server attaches to the SAME http.Server)
```

Key transport decision: an HTTP layer was added to the server and the existing WebSocket server now attaches to the same `http.Server`, so usage reporting + the admin dashboard + the multi-participant WS protocol all share one port. The HTTP layer uses Node's built-in `http` + `crypto` modules only - **no new server dependencies** (no Express/JWT/bcrypt libraries). This keeps the IIS deployment dependency-free.

---

## Server side (`server/`)

### Files
- `server/src/usage/types.ts` - shared types (TokenCounts, ModelUsage, PriceRow, CostConfig, DeveloperRecord, UsageRecord, UsageWindow).
- `server/src/usage/PriceDefaults.ts` - seed price list (USD per 1M tokens) + `defaultCostConfig()`. Includes an `unknown` zero-priced fallback row.
- `server/src/usage/CostCalculator.ts` - `computeCost(usageByModel, prices)`; `resolvePriceKey()` (exact -> prefix -> `unknown`); raw + weighted token helpers. Surfaces `unpricedTokens` / `unpricedModels` so unknown-model tokens are never silently zero-costed.
- `server/src/usage/UsageStore.ts` - append-only JSONL persistence (mirrors `SessionPersistence`), in-memory aggregates, developer registry, cost-config read/save. Replays files on startup.
- `server/src/usage/UsageAggregator.ts` - pure aggregation: `buildSummary()` (KPIs, model mix, time series, `leaderboard` = window-active consumers, `developers` = the full roster of EVERY registered developer with their last-report time + `activeInWindow` flag, alerts) and `buildDeveloperDetail()` (drill-down). Buckets by `serverReceivedAt`. The `developers` roster guarantees per-developer last-report visibility even for idle (heartbeat-only) or never-reported developers; the SPA renders it as a dedicated "registered developers" table in addition to the consumption leaderboard.
- `server/src/admin/AdminAuth.ts` - verifies admin credentials (salted scrypt hash, constant-time compare), issues/verifies HS256 session tokens, `requireAdmin`-style `verify()`.
- `server/src/util/crypto.ts` - self-contained crypto: `randomToken`, `hashSecret`/`verifySecret` (scrypt), `timingSafeEqualStr`, minimal HS256 `signJwt`/`verifyJwt`.
- `server/src/http/UsageHttpServer.ts` - the HTTP request handler: all REST routes, static SPA serving (path-traversal guarded, SPA fallback), JSON body parsing with a 256 KB cap, input clamping, and fixed-window rate limiting on `/api/admin/login` and `/api/usage/*`.
- `server/public/admin/index.html` - the standalone dashboard SPA (self-contained: inline CSS + JS, RTL Hebrew, no external resources). Computes the API base path at runtime so it works whether served at `/admin` or `/<prefix>/admin` behind the IIS proxy.

### Modified
- `server/src/CoordinationServer.ts` - `start(port, httpServer?)` accepts an injected `http.Server`; when present, the WS server attaches via `new WebSocketServer({ server })` instead of binding the port itself.
- `server/src/index.ts` - creates `http.createServer(usageHttp.handler)`, wires `UsageStore` + `AdminAuth` + `UsageHttpServer`, calls `server.start(port, httpServer)` then `httpServer.listen(port)`. Reads the new env vars.

### Storage (JSONL, under `CLAUI_USAGE_DIR`)
- `developers.jsonl` - registry events: `{ev:'register', developerId, displayName, deviceId, tokenHash, createdAt}` and `{ev:'lastReport', developerId, at, deviceId}`. The bearer credential is stored only as a salted scrypt hash.
- `usage.jsonl` - one record per accepted **non-empty** report delta: `{developerId, deviceId, serverReceivedAt, usage:[{model,input,output,cacheCreation,cacheRead}]}`. An empty (heartbeat) report still refreshes the developer's `lastReportAt` (persisted as a `lastReport` event in `developers.jsonl`) but is NOT written here and never enters the aggregate, so heartbeats neither bloat storage nor affect cost/leaderboard figures.
- `prices.json` - the single cost-config document (prices + thresholds), overwritten on save. Editing prices retroactively re-prices all history (cost is derived on read).

### REST API
| Method + path | Auth | Purpose |
|---|---|---|
| `POST /api/usage/register` | shared secret header `X-ClaUi-Register-Token` | create developer; returns `{developerId, developerToken}` |
| `POST /api/usage/report` | `Authorization: Bearer <developerToken>` | append a usage delta; server stamps `serverReceivedAt` |
| `POST /api/admin/login` | body `{username,password}` | sets HttpOnly `claui_admin` session cookie |
| `POST /api/admin/logout` | - | clears the cookie |
| `GET /api/admin/session` | - | `{authenticated, configured}` (SPA bootstrap) |
| `GET /api/admin/summary?window=` | admin cookie/Bearer | KPIs + leaderboard + model mix + series + alerts + lastReportAt |
| `GET /api/admin/developer?id=&window=` | admin | per-developer drill-down |
| `GET /api/admin/prices` / `PUT /api/admin/prices` | admin | read / save the cost config |
| `GET /admin`, `GET /admin/*` | - (the SPA self-gates) | static dashboard |

Windows: `today`, `7d`, `30d` (default), `quarter`. Always bucketed by server-received time (client timestamps are informational only).

### Alerts (computed in `/api/admin/summary`)
- **Budget breach** - per-developer 30-day cost over `monthlyBudgetUsd` (0 disables).
- **Usage spike** - current window cost vs prior equal window over `spikePercent`.
- **Inactive developer** - no successful report in `inactiveDays` days.

### Server env vars
| Var | Purpose |
|---|---|
| `CLAUI_ADMIN_USER` | admin dashboard username (login disabled if unset) |
| `CLAUI_ADMIN_PASSWORD` | admin dashboard password (login disabled if unset) |
| `CLAUI_ADMIN_JWT_SECRET` | signs admin session tokens (random per-process if unset; sessions then reset on restart) |
| `CLAUI_REGISTER_TOKEN` | shared secret required to register a developer (falls back to `CLAUI_SESSION_TOKEN`) |
| `CLAUI_USAGE_DIR` | usage storage dir (default `<CLAUI_PERSISTENCE_DIR>/usage`, else `./usage-data`) |
| `CLAUI_ADMIN_PUBLIC_DIR` | override path to the SPA static files |

---

## Extension side (`src/extension/`)

### Files
- `src/extension/usage/UsageReportClient.ts` - thin Node `http`/`https` JSON client (bearer auth, 15 s timeout, no retry - the hourly cadence is the retry). `deriveHttpBaseFromWs()` converts a `ws(s)://` URL to `http(s)://`.
- `src/extension/usage/DeveloperUsageReporter.ts` - owns `DeveloperUsageState` in `globalState` (key `claudeMirror.developerUsage`): per-model/per-type cumulative counts, `lastReportedCumulative`, `lastSuccessfulReportAt`, `deviceId` (from `vscode.env.machineId`), consent flag. `recordTurn()` accumulates. `flushReport()` is re-entrancy-guarded (a `flushing` flag) and: (1) **snapshots** `cumulative` at the moment the delta is computed, sends `delta = snapshot - lastReportedCumulative`, and on success advances the baseline to **that snapshot** (never the live, possibly-larger state) so a turn recorded while the POST is in flight is neither lost nor double-counted - it simply goes out next cycle; (2) **always sends, even on a zero delta** - the hourly report doubles as a heartbeat so an online-but-idle developer still refreshes their last-report time (keeping the dashboard time and the inactive-developer alert correct). `register()` registers + stores the credential in **SecretStorage** (key `claudeMirror.developerToken`) and baselines so only post-consent usage is reported; `getMyUsageSnapshot()` powers the personal card (uses a local default price table for an estimate). Hourly `setInterval` + an opportunistic flush ~30 s after activation if overdue.

### Modified
- `src/extension/webview/MessageHandler.ts` - new field + `setDeveloperUsageReporter()`; calls `developerUsageReporter?.recordTurn({...})` at the two existing `tokenRatioTracker.recordTurn` sites (success + error), passing the **full** `currentTurnModel` (not normalized).
- `src/extension/session/SessionTab.ts` + `TabManager.ts` - thread the optional reporter through and call `setDeveloperUsageReporter()`.
- `src/extension/extension.ts` - instantiates `DeveloperUsageReporter(globalState, secrets, configGetter, machineId, log)`, starts the hourly timer, disposes on deactivate, passes it to `TabManager` and `registerCommands`.
- `src/extension/commands.ts` - three commands (below) + a script-free `My Usage` webview panel (`buildMyUsageHtml`).

### Commands
- `claudeMirror.registerUsageReporting` - consent modal (lists exactly what is sent / not sent) -> display-name prompt -> server register -> enables the setting + first flush.
- `claudeMirror.viewMyUsage` - opens the personal card (estimated cost, weighted/raw tokens, primary model, last report time). No ranking or comparison to others.
- `claudeMirror.disableUsageReporting` - clears consent, disables the setting, deletes the stored credential.

### Settings
- `claudeMirror.usageReporting.enabled` (bool, default false)
- `claudeMirror.usageReporting.serverUrl` (string; if empty, derived from `claudeMirror.multiParticipant.serverUrl`)
- `claudeMirror.usageReporting.developerName` (string)

(`developerId` lives in `globalState`; the developer credential lives in `SecretStorage` - never in settings.)

---

## Privacy

- **Only numeric token counts leave the client** (model id + per-type counts). No prompts, code, file paths, or conversation content - enforced by construction (`DeveloperUsageReporter` only ever holds counts).
- **Consent opt-in, default off.** No report without `consentGranted` AND the enabled setting.
- Developer credential in SecretStorage; bearer on every report; admin surface behind login (constant-time credential compare, signed session token, rate-limited login).
- A developer sees only their own data; ranking/comparison is admin-only.
- The feature shares the server process but uses its own storage files and in-memory store; it never reads or mutates session/transcript state, and `TokenUsageRatioTracker` is left untouched.

---

## Default price list (USD per 1M tokens)

| Model | input | output | cacheCreation (5-min) | cacheRead |
|---|---|---|---|---|
| claude-opus-4-8 / 4-7 / 4-6 / 4-5 | 5.00 | 25.00 | 6.25 | 0.50 |
| claude-sonnet-5 / 4-6 / 4-5 | 3.00 | 15.00 | 3.75 | 0.30 |
| claude-haiku-4-5 | 1.00 | 5.00 | 1.25 | 0.10 |
| claude-fable-5 | 10.00 | 50.00 | 12.50 | 1.00 |

cacheCreation = input x 1.25 (5-min TTL, Claude Code default); cacheRead = input x 0.1. Currency defaults to USD; a configurable `exchangeRate` allows a different display currency without hardcoding one.

---

## Known limitations / future work
- JSONL retention/compaction is not yet implemented (define a policy before long-term production use).
- The personal "My Usage" cost is an estimate using a bundled default price table (the authoritative, admin-editable prices live on the server).
- Re-registration (e.g. after losing `globalState`) creates a new `developerId`; `deviceId` is kept to debug double-counting across devices.
