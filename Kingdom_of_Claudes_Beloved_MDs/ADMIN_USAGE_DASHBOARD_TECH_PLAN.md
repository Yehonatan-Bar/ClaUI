# Admin Usage Dashboard — Technical Implementation Plan

Audience: the software engineer implementing the feature.
Companion product spec (Hebrew, manager-facing): `Kingdom_of_Claudes_Beloved_MDs/ADMIN_USAGE_DASHBOARD_SPEC_HE.html`.

---

## 1. Goal

Add a central **admin usage dashboard** that aggregates token consumption and estimated **API cost** across all registered developers. The dashboard is a **separate web page served by the coordination server** (not a webview inside the extension), reachable in a browser by a manager who logs in with a username/password.

Cost is computed as **raw token counts × API price**, per model and per token type. There is **no "percentage of quota / value-of-1%" concept** anywhere in this feature — that framing was explicitly dropped. Costs are **API costs only** (not subscription/plan costs), with a uniform price list for the whole team, editable in the admin UI.

### Locked product decisions (do not re-litigate)
1. **Dashboard surface:** standalone web page served by the server; manager logs in via browser.
2. **Ranking/comparison between developers:** visible to admin only. A developer sees only their own data.
3. **Pricing:** single uniform API price list for the whole team, configured once in the admin UI, seeded with defaults. UI must clearly state these are API costs, not subscription/plan costs.
4. **Admin auth:** username + password defined at server setup (env). Dashboard requires login.
5. **Reporting cadence:** client reports automatically **every hour**. If the developer is offline the report **fails silently** and retries next cycle. The dashboard always shows the **last successful automatic report time** (globally and per developer).

---

## 2. What already exists (build on this, do not rebuild)

### 2.1 Token counting (data source) — extension side
- `src/extension/session/TokenUsageRatioTracker.ts` — accumulates tokens per turn. Relevant facts:
  - Per-turn input is `TurnTokens { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, model? }` (lines 65–73).
  - It keeps **global** per-type cumulative counts (`cumulativeTokens`), a **per-model raw total** (`cumulativeRawTokensByModel`), and per-model weighted totals — but **NOT per-model-per-type counts**. (lines 52–63.)
  - Model normalization (`normalizeModelCategory`, lines 33–39) only recognizes `opus | sonnet | haiku` (`MODEL_CATEGORIES`, line 27); any other model id (e.g. Fable) normalizes to `null`.
  - Persisted in VS Code `globalState` under key `claudeMirror.tokenUsageRatio`.
- `src/extension/webview/MessageHandler.ts` — the single place that feeds per-turn tokens:
  - Token fields are read from the CLI `result` event: `usage.input_tokens`, `usage.output_tokens`, `usage.cache_creation_input_tokens`, `usage.cache_read_input_tokens` (around line 5619).
  - The active model is captured into `this.currentTurnModel` from the `messageStart` event (line 5337).
  - `tokenRatioTracker.recordTurn({...})` is called on both the success path (~line 5638) and the error path (~line 5699).
- **Implication:** to compute API cost accurately we need **per-model, per-token-type** counts (each type has a different price). The existing tracker is insufficient on its own — we add a new accumulator fed from the same MessageHandler hook. **Do not** repurpose `TokenUsageRatioTracker`; leave its quota/ratio behavior untouched.

### 2.2 Coordination server (transport + identity host) — `server/`
- `server/src/index.ts` — entry point. Reads env (`CLAUI_SERVER_PORT` default 9120, `CLAUI_SESSION_TOKEN`, `CLAUI_PERSISTENCE_DIR`, guard vars) and starts `CoordinationServer`.
- `server/src/CoordinationServer.ts` — a **WebSocket-only** server today. It currently creates its own `WebSocketServer`. No HTTP routes exist.
- `server/src/SessionPersistence.ts` — append-only **JSONL** persistence pattern; replayed on startup to rebuild in-memory state. Reuse this pattern for usage storage.
- Identity today is **ephemeral per-session** (random participant UUIDs in `server/src/types.ts`). There is **no registered-developer concept** and **no usage/cost data on the wire** (`AgentEventPayload` carries no token/cost fields). Both are new in this feature.
- Client config lives in `package.json` under `claudeMirror.multiParticipant.*` (serverUrl, authToken, default names).

---

## 3. Architecture overview

Three pieces, added alongside existing code:

```
[ Extension client ]                 [ Coordination server ]                 [ Admin browser ]
DeveloperUsageReporter  --HTTPS-->   HTTP layer (new):                       GET /admin (static SPA)
  - per-model/type counts            POST /api/usage/report   -> UsageStore  - login (cookie/JWT)
  - hourly timer                     POST /api/admin/login    -> AdminAuth   - KPIs, leaderboard,
  - consent gate                     GET  /api/admin/summary  -> aggregate     charts, alerts,
  - persists last-report state       GET/PUT /api/admin/prices-> CostConfig    price settings
                                     serves /admin static files
                                     (existing WS server runs unchanged on same http.Server)
```

Key transport decision: **add an HTTP layer to the server** and attach the existing WebSocket server to the same `http.Server`. Usage reporting and the admin dashboard go over HTTP/REST; the multi-participant WS protocol is left as-is. Rationale: the dashboard is a separate web page (decision #1) and usage reporting is session-independent — REST is the natural fit and keeps it decoupled from the session protocol.

---

## 4. Data model

### 4.1 Client-side per-turn accumulation (new)
New persisted structure (VS Code `globalState`, distinct key e.g. `claudeMirror.developerUsage`):
```
DeveloperUsageState {
  developerId: string | null;          // assigned by server at registration
  consentGranted: boolean;             // default false
  // cumulative since install, per model category, per token type:
  cumulative: Record<modelKey, { input, output, cacheCreation, cacheRead }>;
  lastReportedCumulative: Record<modelKey, { input, output, cacheCreation, cacheRead }>;
  lastSuccessfulReportAt: number | null;
  deviceId: string;                    // stable per machine, to disambiguate multi-device
}
```
- `modelKey`: prefer the **full model id** (e.g. `claude-opus-4-8`) captured from `currentTurnModel`, normalized to a stable pricing key. Keep a fallback bucket `unknown` for unrecognized ids so no tokens are lost (the existing `opus|sonnet|haiku` normalization drops everything else — do not inherit that limitation).
- Each report sends the **delta** = `cumulative - lastReportedCumulative`. On a **successful** report, set `lastReportedCumulative = cumulative` and `lastSuccessfulReportAt = now`. On failure, leave them; next cycle's delta naturally includes the un-reported usage (no data loss across silent failures, as long as globalState persists). This makes reports idempotent-ish and resilient to the hourly silent-failure requirement.

### 4.2 Report payload (client -> server)
```
POST /api/usage/report
Authorization: Bearer <developerToken>
{
  developerId, deviceId,
  reportedAt,                          // client clock (informational only)
  windowStart, windowEnd,              // client clocks (informational)
  usage: [ { model: "claude-opus-4-8", input, output, cacheCreation, cacheRead }, ... ]
}
```
Server stamps its own authoritative `serverReceivedAt` and appends a record. **Never trust client timestamps for windowing** — bucket by `serverReceivedAt`.

### 4.3 Server-side storage (new — JSONL, mirrors SessionPersistence)
- `developers.jsonl` — registry events: `{ ev:'register', developerId, displayName, createdAt }`, `{ ev:'lastReport', developerId, at }`.
- `usage.jsonl` — one record per accepted report delta: `{ developerId, deviceId, serverReceivedAt, usage:[...] }`.
- `prices.json` — current price config (see §6), single document overwritten on save.
On startup, replay both JSONL files into in-memory aggregates (same approach as `CoordinationServer.loadAllSessions`).

### 4.4 Aggregation
In-memory index keyed by `developerId`, each holding time-bucketed token sums per model/type. Windows (`today`, `7d`, `30d`, `quarter`) computed by summing deltas whose `serverReceivedAt` falls in range. Cost is derived on read from current `prices.json` (so editing prices retroactively re-prices history — desired).

---

## 5. Client implementation (extension)

### 5.1 New files
- `src/extension/usage/DeveloperUsageReporter.ts`
  - Owns `DeveloperUsageState` (load/save via `globalState`, write-queue serialization like `TokenUsageRatioTracker.enqueueWrite`).
  - `recordTurn(tokens: TurnTokens)`: accumulate into `cumulative[modelKey][type]`. Reuse the `TurnTokens` type.
  - `startHourlyTimer()`: `setInterval(60*60*1000)` → `flushReport()`. Also call `flushReport()` opportunistically on activation (if >1h since last) and best-effort on `deactivate`.
  - `flushReport()`: if `!consentGranted || !developerId || !serverUrl` → return. Compute delta; if all-zero → skip. POST; on 2xx update `lastReportedCumulative`/`lastSuccessfulReportAt`; on any error **swallow** (log via existing logger only). Never surface errors to the user.
  - `register(displayName)`: POST `/api/usage/register` with `CLAUI_SESSION_TOKEN`-style shared secret; store returned `developerId` + `developerToken` (token in **SecretStorage**, not settings).
  - `getMyUsageSnapshot()`: for the "My Usage" card.
- `src/extension/usage/UsageReportClient.ts` — thin HTTPS client (Node `https`/`fetch`), base URL from settings, bearer auth, short timeout, no retry (hourly cadence is the retry).
- `src/webview/components/Usage/MyUsageCard.tsx` (MVP-optional, phase D) — personal card: estimated API cost this month, weighted tokens, primary model, last automatic report time. **No ranking** (decision #2).

### 5.2 Modifications
- `src/extension/webview/MessageHandler.ts` — at the two existing `tokenRatioTracker.recordTurn(...)` call sites (~5638 success, ~5699 error), also call `developerUsageReporter?.recordTurn(sameTokens)`. Pass the **full** `this.currentTurnModel` (not normalized). Add a setter `setDeveloperUsageReporter()` mirroring `setTokenRatioTracker` (line ~549).
- `src/extension/extension.ts` — instantiate `DeveloperUsageReporter(context.globalState, context.secrets)`; start its hourly timer; pass it down the same path the tracker uses (`SessionTab` → `TabManager` → `MessageHandler`).
- `src/extension/commands.ts` — new commands: `claudeMirror.registerUsageReporting` (prompts for display name + runs consent dialog), `claudeMirror.viewMyUsage`, `claudeMirror.disableUsageReporting`.
- `package.json` — new settings + commands (see §8).

### 5.3 Consent
Default OFF. First registration shows an explicit modal listing exactly what is sent (numeric token counts per model/type) and what is not (no code, prompts, file names). `consentGranted` gates all reporting. Provide a one-click off switch.

---

## 6. Server implementation

### 6.1 New files
- `server/src/http/UsageHttpServer.ts` — an Express app (add `express` dep) mounting:
  - `POST /api/usage/register` — gated by shared secret (reuse `CLAUI_SESSION_TOKEN` or new `CLAUI_REGISTER_TOKEN`); creates/returns `{ developerId, developerToken }`.
  - `POST /api/usage/report` — bearer `developerToken`; validates payload; appends to `usage.jsonl`; updates `lastReport`.
  - `POST /api/admin/login` — checks admin credentials; sets HttpOnly cookie / returns JWT.
  - `GET /api/admin/summary?window=30d` — admin-auth; returns KPIs + per-developer leaderboard + model mix + time series + alerts + `lastReportAt` (global + per developer).
  - `GET /api/admin/prices`, `PUT /api/admin/prices` — admin-auth; read/save `prices.json`.
  - Static: serve `server/public/admin/**` at `/admin`.
- `server/src/usage/UsageStore.ts` — JSONL append + in-memory aggregation + windowing (bucket by `serverReceivedAt`), developer registry, `lastReportAt`.
- `server/src/usage/CostCalculator.ts` — `cost = Σ_model Σ_type (tokens[model][type] / 1_000_000) × price[model][type]`. Maps a reported full model id to a price row; falls back to a default/`unknown` row and surfaces "unpriced tokens" so they aren't silently zero-costed.
- `server/src/usage/PriceDefaults.ts` — seed defaults (USD per 1M tokens), from the official price list in `Kingdom_of_Claudes_Beloved_MDs/tokens_usage_costs_HE.txt`:

  | Model | input | output | cacheCreation (5-min) | cacheRead |
  |---|---|---|---|---|
  | claude-opus-4-8 | 5.00 | 25.00 | 6.25 | 0.50 |
  | claude-opus-4-7 | 5.00 | 25.00 | 6.25 | 0.50 |
  | claude-opus-4-6 | 5.00 | 25.00 | 6.25 | 0.50 |
  | claude-sonnet-4-6 | 3.00 | 15.00 | 3.75 | 0.30 |
  | claude-haiku-4-5 | 1.00 | 5.00 | 1.25 | 0.10 |
  | claude-fable-5 | 10.00 | 50.00 | 12.50 | 1.00 |

  Notes from source: cacheCreation = input × 1.25 (5-min TTL, Claude Code default); cacheRead = input × 0.1. (A 1-hour cache-write tier exists at input × 2.0 but Claude Code uses 5-min; out of MVP scope.) Currency is **USD**; display currency is configurable (default USD) — if ₪ display is wanted later, add a single configurable exchange rate, do not hardcode one.

- `server/src/admin/AdminAuth.ts` — verify against `CLAUI_ADMIN_USER` + `CLAUI_ADMIN_PASSWORD` (store a hash; compare with constant-time). Issue/verify session token (JWT signed with a server secret, or signed cookie). Middleware `requireAdmin`.
- `server/public/admin/` — the standalone dashboard SPA (plain HTML/CSS/JS or a tiny bundle): login screen, KPI cards, cost-over-time chart, model-mix, leaderboard table (with cost-share meter), drill-down, alerts panel, and the price-settings screen. Mirror the layout in the Hebrew spec mockups.

### 6.2 Modifications
- `server/src/index.ts` — create `http.createServer`, mount `UsageHttpServer`'s Express app, and attach the existing WebSocket upgrade to the same server instead of a standalone WS port. Read new env: `CLAUI_ADMIN_USER`, `CLAUI_ADMIN_PASSWORD`, `CLAUI_ADMIN_JWT_SECRET`, `CLAUI_USAGE_DIR` (storage dir; default under `CLAUI_PERSISTENCE_DIR`).
- `server/src/CoordinationServer.ts` — accept an injected `http.Server`/`noServer` mode so WS and HTTP share a port (use `WebSocketServer({ server })` or `{ noServer:true }` + `upgrade` handler).
- `server/package.json` — add `express` and a JWT/cookie lib; keep `ws`.
- `server/deploy/` — update `SERVER_SETUP_GUIDE.md`, `web.config` (IIS) to expose the HTTP route and the new env vars; document admin credential setup.

### 6.3 Alerts (server-derived in `/api/admin/summary`)
- **Budget breach:** per-developer monthly cost > configured budget threshold.
- **Usage spike:** current window vs prior window > configurable % (e.g. +150%).
- **Inactive registered developer:** no successful report in N days (default 14).

---

## 7. Security, privacy, isolation
- **Only numeric token counts leave the client** (model id + per-type counts). No prompts, code, file paths, or conversation content. Enforce by construction: `DeveloperUsageReporter` only ever holds counts.
- **Consent opt-in, default off.** No report without `consentGranted`.
- **Transport:** require HTTPS/WSS in production; `developerToken` in SecretStorage; bearer on every report.
- **Admin surface behind auth:** all `/api/admin/*` and `/admin` static require a valid admin session; constant-time credential compare; sign tokens with a server secret. Rate-limit `/api/admin/login` and `/api/usage/*`.
- **Input validation:** reject malformed/oversized report payloads; clamp negative deltas to zero; cap per-report token magnitudes to sane bounds.
- **Isolation:** usage feature shares the server process but uses its own storage files and in-memory store; it must not read or mutate session/transcript state. Keep `TokenUsageRatioTracker` untouched.
- **Multi-device:** sum across `deviceId`s for one `developerId`; keep deviceId to debug double-counting.

---

## 8. Extension settings & commands (`package.json`)
- Settings: `claudeMirror.usageReporting.enabled` (bool, default false), `claudeMirror.usageReporting.serverUrl` (string; may default from `multiParticipant.serverUrl` host), `claudeMirror.usageReporting.developerName` (string). `developerId`/`developerToken` are NOT settings (globalState + SecretStorage).
- Commands: `claudeMirror.registerUsageReporting`, `claudeMirror.viewMyUsage`, `claudeMirror.disableUsageReporting`.
- After any `package.json` change: `npm run deploy:local`, reload VS Code, then `npm run verify:installed` (mandatory for new commands/settings per project `CLAUDE.md`).

## 9. Phased delivery
- **A — Identity & reporting:** `DeveloperUsageReporter`, consent, registration, hourly POST, server `register`+`report` endpoints, `UsageStore`. Verify reports land in `usage.jsonl`.
- **B — Admin page & pricing:** HTTP layer on shared port, admin login, `/admin` SPA with KPIs + leaderboard, `CostCalculator` + price settings screen seeded from defaults. This is the core value.
- **C — Insights & alerts:** time-series charts, per-developer drill-down, alerts panel, CSV/report export.
- **D — Personal card & polish:** webview "My Usage" card, budget config, privacy/permission hardening.

## 10. Testing
- **Unit:** `CostCalculator` (counts × prices, multi-model sums, unknown-model fallback, cache-type pricing); `UsageStore` aggregation + window bucketing by `serverReceivedAt`; reporter delta logic incl. failure-then-recovery (no loss, no double count); `AdminAuth` (good/bad creds, expired token).
- **Integration:** register → report (×N hourly) → `GET /api/admin/summary` matches expected totals/cost; offline report fails silently and the next succeeds; price edit re-prices history; admin endpoints reject unauthenticated calls.
- **Manual:** open `/admin` in a browser, log in, confirm leaderboard/cost/last-report-time render and price edits update figures live.

## 11. Risks / open technical points
- **Model id normalization** for pricing (new/renamed models) — mitigate with `unknown` fallback + "unpriced tokens" surfacing + admin ability to add rows.
- **Currency display** — USD by default; ₪ requires a configurable exchange rate (do not hardcode).
- **Clock skew** — always bucket by server-received time.
- **Shared-port refactor** of the WS server — test that existing multi-participant sessions still connect after attaching HTTP to the same `http.Server`.
- **Data retention** — define a JSONL retention/compaction policy before long-term production use.
