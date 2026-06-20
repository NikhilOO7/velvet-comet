# Velvet Comet — Build Plan

*Acting as staff engineer / product engineer on the Firecrawl take-home brief. Grounded in Firecrawl's current v2 (mid-2026) capabilities so we don't rebuild something that already ships.*

---

## 1. Triage: what actually matters (and what's already shipped)

All 11 feedback items scored against four axes: **business weight** (ARR + renewal/expansion urgency from `data/accounts.csv`), **support cost** (`data/tickets.csv`), **is-it-already-built** (the README's explicit trap), and **demoability + depth fit**.

| # | Customer | ARR | Signal | Already exists? | Verdict |
|---|----------|-----|--------|-----------------|---------|
| **1** | Competitive-intel platform | **$180k**, renewal **Q3** | Completeness; deep-research deprecated; runs thousands of queries/night batch | **Gap** — `/deep-research` deprecated Jun 2025, no replacement product | **PRIMARY** |
| **5** | AI research startup | $36k, ↑14% | Wants rerank / `intent` on search | **Gap** — only a `categories` filter exists, no rerank | **PAIR with #1** |
| 4 | Indie dev | $348 | "fast, 3 results, snippets only" | **ALREADY EXISTS** — omit `scrapeOptions` → SERP-only ~sub-second | Educate, don't build |
| 2 | Price comparison | $42k, ↓8% | BYO residential proxies | **Mostly exists** — `proxy:auto` retries basic→enhanced; BYO is self-host only | Educate + smart retry, not core |
| 7 | Workflow automation | $28k | 14-step `actions` → one `SCRAPE_FAILED`; which step? | **Gap** — no per-step error / index / timing | Strong runner-up |
| 9 | Data infra | $38k | Self-maintaining extractors | **Gap** — `/extract` is stateless | Runner-up |
| 8 | Startup (inline) | $31k | p99 latency tails 40s+ | Partial — `timeout` exists, no predict | Folds into #1's infra |
| 3 | OSS user | $0 | `dedupe:true` for markdown | **Gap** but small, self-solved | Skip (we get it for free) |
| 6 | Fortune 500 prospect | 7-figure / 3yr | "AI understands any website" | Vision, not a feature | Too broad |
| 10 | Sales intel | $60k | LinkedIn at scale | Policy-blocked; ToS / legal | **Avoid** |
| 11 | AI agent startup | $0 trial | Auth sessions + credentials | **Mostly exists** — `profile` + `/interact` | Educate |

### The decision

**Build the completeness-first research engine that customer #1 is describing, with customer #5's intent-aware reranking as the second composable capability.** Project name: **Velvet Comet**.

**Why this and not the runner-ups:**

- **Highest stakes, soonest clock.** $180k enterprise, *renewal this quarter*, explicit expansion to two more teams gated on this. Single largest at-risk + expand number in the dataset, and "search relevance / result count" is 38 tickets — so #1 isn't a snowflake.
- **It's a real product gap, not a trap.** Firecrawl deprecated `/deep-research` (Jun 30 2025) and told users to "orchestrate `/search` + `/scrape` yourself." Customer #1 *noticed the deprecation*. We rebuild that capability as a productized, batch-native surface — exactly the void.
- **It plays to scalable / reliable system design.** "A few thousand queries a night, runs overnight, make it 10× slower I don't care, nobody watches a spinner." That is a *batch orchestration / throughput / reliability* problem, not a latency problem — the most interesting infra story in the eleven.
- **It composes multiple Firecrawl capabilities** — `/search` (the fan-out) plus `/scrape` (the deepen step, `request.deepen`) — and forces handling of every messy part the brief names: retries, slow pages, empty results, dedup. (`/map`+`/crawl` for authority-hub discovery and `changeTracking` for monitoring are designed in §3/§15 but not yet built.)

**The core insight driving the whole design** (from the #1 call): *"going from ten to fifty gave us forty more of the same SEO winners. The sources we miss don't show up at any limit."*

> **Completeness is not a `limit` problem — raising `limit` returns more of the same head. Completeness is a query-coverage + source-diversity problem.**

That reframing is the product.

---

## 2. Product surfaces

Three surfaces over one engine (brief: "a real product surface someone could actually use"):

1. **Research API** — `POST /v1/research` (sync for small, async + webhook for batch). The primary product; what #1 wires into their nightly pipeline.
2. **Batch Console** (web dashboard) — submit a query set, watch jobs stream, inspect *coverage* per query (which domains / source-classes were hit, saturation curve, what was deduped), download results. The demoable surface and the operability story.
3. **CLI** — `vc research "..." --intent research --coverage high` for quick analyst use and live demo.

---

## 3. The completeness engine (the actual IP)

A bounded, saturating fan-out instead of a single `/search?limit=50`:

```
query
  │
  ▼
① Query expansion (LLM)  ── generate K angled sub-queries:
  • paraphrases / synonyms        • entity & facet decomposition
  • source-class targeting:       site:forum, "trade publication",
    regional terms, niche TLDs    long-tail vs head terms
  │
  ▼
② Multi-source fan-out (parallel, rate-budgeted)
  • /search sources:[web, news]   • targeted /map+/crawl of authority hubs
  • categories: research/github     discovered in round 1 (find their links)
  │
  ▼
③ Diversity-aware merge
  • URL + content-hash dedup (SimHash near-dup, solves #3 for free)
  • per-domain quota → SEO winners can't crowd out the long tail
  │
  ▼
④ Coverage scoring + saturation stop  ← "loop until dry"
  • new round only while it yields NEW domains / source-classes
  • stop at saturation OR coverage budget — this is the "10× slower is fine" lever
  │
  ▼
⑤ Intent-aware rerank (customer #5)
  • intent ∈ {news, research, buying} → freshness | domain authority |
    comparison-page detection. Pluggable scorer, declared per request.
  │
  ▼
results + coverage report (which classes hit / missed, saturation curve)
```

Steps ① and ④ are what find the trade pubs and niche forums that *don't appear at any `limit`*: we change the *queries*, not the result count, and keep going until the domain set stops growing. The coverage report is the trust artifact for an enterprise whose "completeness is the product."

---

## 4. Production architecture

```
   API / CLI / Console
        │  research request (intent, coverage profile, idempotency key)
        ▼
   ┌─────────────┐
   │ API Gateway │  auth, quotas, idempotency (unique constraint)
   └──────┬──────┘
          │ classify workload → HOT or COLD
          ▼
   ┌──────────────────────────────────────────────┐
   │  Two priority lanes (BullMQ)                  │
   │   • HOT  lane  → interactive, capped rounds   │
   │   • COLD lane  → nightly batch, full coverage │
   └───────┬───────────────────────────┬──────────┘
           │                           │
           ▼                           ▼
   ┌──────────────────────────────────────────────┐
   │  COORDINATOR / Saturation Controller          │  durable job state in PG;
   │  owns round N→N+1 decisions, fan-out,         │  Temporal-portable state
   │  barriers, finalize. NOT a fixed DAG.         │  machine (hand-rolled now)
   └───────┬───────────────────────────┬──────────┘
   re-enqueues each round as stage tasks │
           ▼                            ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ Expansion  │  │ Fan-out    │  │ Rerank /   │   Stateless workers,
     │ workers    │  │ workers    │  │ merge      │   autoscaled, preemptible
     │ (LLM leaf) │  │ (Firecrawl)│  │ workers    │   on the COLD lane
     └─────┬──────┘  └─────┬──────┘  └─────┬──────┘
           │               │               │
           ▼               ▼               ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Firecrawl Client Layer (single chokepoint)               │
   │  • Redis Lua rate limiter (rpm)  + leased semaphore       │
   │    (in-flight concurrency, TTL-reclaimed)                 │
   │  • priority arbiter: HOT preempts COLD on the budget      │
   │  • retry w/ jitter, per-domain circuit breaker            │
   │  • read-through cache (maxAge / content-hash); COLD warms  │
   │    it, HOT reads it                                       │
   └──────────────────────────────────────────────────────────┘
           │                                          │
           ▼                                          ▼
   ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐
   │ Postgres     │   │ Object store │   │ Redis (queues, rate   │
   │ (jobs,rounds,│   │ (raw pages,  │   │ buckets, semaphore,   │
   │ results,     │   │ snapshots)   │   │ dedup/saturation sets,│
   │ coverage)    │   │              │   │ idempotency)          │
   └──────────────┘   └──────────────┘   └──────────────────────┘
           ▲
           │  Firecrawl webhooks (batch_scrape.*, crawl.*) — idempotent,
           │  reconciled against polling backstop → job state
   Observability: structured logs, traces, per-stage metrics, cost meter
   MCP server: thin adapter over the Research API (see §5a)
```

**Why this shape:** the workload is embarrassingly parallel, bursty (thousands of queries dumped at 2am), and bottlenecked entirely on **Firecrawl's per-plan rate limits and concurrency**, not on our CPU. So the design centers on a **queue + stateless workers + a single chokepoint Firecrawl client that owns the rate / concurrency budget**. Two refinements over a naive pipeline, both decided *before* writing code because they change topology:

1. **A coordinator, not a fixed DAG.** The completeness engine is a *durable loop with data-dependent fan-out* — step ④ decides at runtime whether to spawn round N+1, and step ② can discover authority hubs that trigger new crawls. A coordinator owns those decisions against durable Postgres state instead of hard-wiring a linear pipeline. Hand-rolled for the 72h demo, but its state machine is designed to port to **Temporal / Inngest** later (see §5).
2. **Hot and cold are split lanes, not one queue.** Two workloads with opposite SLAs share one engine but not one budget (see §4a).

### 4a. Hot vs. cold paths

| | Cold path (nightly batch) | Hot path (sync API / console / CLI) |
|---|---|---|
| Latency | irrelevant ("10× slower is fine") | someone is waiting |
| Coverage | full saturation, max rounds | capped rounds, return partial fast |
| Queue | low priority, preemptible | priority lane, never starved |
| Cache | **populates** the warm cache | **reads through** it |
| Deadlines | generous | tight per-call, hedge on p95 |

Same engine code, two config profiles (`coverage=high|fast`, round caps, deadlines). The **rate arbiter gives the hot path priority on the token bucket** so a 5,000-query batch dump can't starve an interactive request.

---

## 5. Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Language** | **TypeScript (Node 20)** end to end | Firecrawl's first-class SDK is `@mendable/firecrawl-js`; one language for API + workers + console; strong async / streaming ergonomics for I/O-bound fan-out |
| **API** | **Fastify** | Low overhead, schema validation, easy webhook receivers |
| **Queue / workers** | **BullMQ on Redis**, two priority lanes (hot / cold) | Per-stage queues, retries with backoff, rate-limiter + concurrency groups built in, delayed jobs for backpressure, priority lanes for the hot/cold split. Matches the chokepoint model exactly |
| **Orchestration** | **Hand-rolled coordinator** (Postgres-backed state machine) for the demo; **Temporal / Inngest** as the production port | The completeness loop is a durable, data-dependent loop — not a fixed DAG. Decision: hand-roll now so the demo has zero extra infra, but write the state machine so the round loop, retries, and resume map cleanly onto a durable-execution engine later |
| **DB** | **Postgres** (Drizzle ORM) | Jobs, results, coverage reports; JSONB for flexible result payloads |
| **Object store** | **S3-compatible** (R2 / MinIO local) | Raw page markdown + screenshots / snapshots; keep heavy blobs out of Postgres |
| **Cache / state** | **Redis** | Rate token-buckets, content-hash dedup sets, idempotency keys, queue |
| **LLM** | **Claude (Opus 4.8 for expansion / intent reasoning, Haiku 4.5 for cheap classification)** | Query expansion, intent scoring, comparison-page detection; tiered for cost |
| **Console** | **Next.js + React + Tailwind**, SSE / WebSocket for live job streaming | Fast to build, good live-demo surface |
| **Infra** | **Docker Compose** for the 72h demo; **Fly.io / Render** target; Terraform sketch for prod | Reproducible local demo; clear prod path without over-building |
| **Observability** | **OpenTelemetry traces + Prometheus metrics + structured logs**; a **cost meter** counting Firecrawl credits per job | The brief rewards handling the messy parts visibly; for a batch product, *cost per query* is a first-class metric |

### 5a. Agentic posture & MCP

- **The core loop is deterministic, not agentic.** It runs thousands of times unattended against a credit budget and must be reproducible, testable, and produce a defensible coverage report. A free-roaming agent making nondeterministic Firecrawl calls is the anti-pattern here — it's literally why Firecrawl's own FIRE-1 has *nondeterministic* credit cost. The **LLM is used only as a bounded function at leaf stages** (query expansion, intent scoring, comparison-page detection): structured in/out, cached, no tool access. **Round control stays deterministic** (saturation = new-domain delta).
- **MCP is a surface, not infra.** Expose the Research API as a thin **MCP server** so #5 (AI research assistant) and #6 (Fortune 500 internal assistant) can plug Velvet Comet into their own agents. Build the HTTP API first; the MCP server is a wrapper over it. Differentiator vs. Firecrawl's existing MCP server: ours is the *completeness / coverage* layer, not raw scrape.

---

## 6. Reliability & scale engineering (the parts that earn the "production" label)

Where #1's "thousands of queries a night, 10× slower is fine, nobody watches a spinner" gets cashed in:

- **Retries with jitter + circuit breaker.** Exponential backoff on 429 / 5xx / timeout; per-domain circuit breaker so one flaky retail domain (cf. #2) doesn't burn the whole batch's budget. Failed pages are quarantined, not fatal — a research job completes partial-but-honest with the gaps recorded in the coverage report.
- **Idempotency + resumability.** Every request carries an idempotency key; every stage checkpoints to Postgres. A worker crash or a redeploy at 3am resumes from the last completed stage instead of re-spending credits. Critical when each job is thousands of Firecrawl calls = real money.
- **Slow-tail handling (#8's pain, reused).** Per-call deadline with hedged behavior: if a scrape exceeds p95, we don't hang the job — mark it slow, let the result arrive async via webhook, and move on. Batch never blocks on one 40s page.
- **Caching.** Firecrawl's `maxAge` (2-day cache) plus our own content-hash cache: identical sub-queries across a nightly batch hit cache, not the API. Direct credit savings, surfaced in the cost meter.
- **Backpressure & cost ceilings.** Per-job credit budget + per-account nightly ceiling; the scheduler throttles fan-out (delayed jobs) rather than overrunning. A runaway expansion can't produce a surprise five-figure bill.
- **Empty-result handling.** A query that returns nothing isn't a silent zero — it escalates (broaden expansion, add `enableWebSearch`, try `news`) and, if still empty, is recorded as a coverage gap with the reason.

### 6a. Concurrency model (the chokepoint, in detail)

The Firecrawl client is the single chokepoint, but Firecrawl enforces **two independent limits** (rpm *and* in-flight concurrency), so the limiter is two primitives, plus several race fixes a naive token bucket misses:

- **Distributed limiter = Redis Lua.** Atomic check-and-decrement (no in-process counters — they race across workers). Two primitives: a **rate limiter** (rpm, sliding window) **and** a **leased semaphore** (in-flight concurrency) whose leases carry a **TTL so a crashed worker's slot is reclaimed**. Keyed per account plan (e.g. Growth = 5,000 scrape rpm / 100 concurrent).
- **Priority arbiter on the budget.** When tokens are scarce, the hot lane drains them first; cold workers back off via delayed re-enqueue (no busy-wait).
- **Saturation state is shared mutable state.** The "seen domains / URLs" sets are written by concurrent fan-out workers → keep them as **atomic Redis sets**, and make the round stop/continue decision **at a barrier** (fan out round N fully → collect → decide N+1) so the stop condition is never evaluated against a half-written set.
- **Dedup race.** Content-hash near-dup detection uses atomic `SETNX` so two workers discovering the same URL don't both emit it.
- **Webhooks are at-least-once and may arrive out of order.** Handlers are idempotent (keyed on Firecrawl job id + event) and **reconciled against a polling backstop** — the webhook is a latency optimization, not the source of truth.
- **Idempotency under retries.** The request idempotency key is a **Postgres unique constraint**, so a redeploy mid-batch can't double-submit and double-spend.
- **Poison jobs.** Max-attempts + **dead-letter queue**; a permanently-failing query is parked, not retried forever.
- **Connection limits.** Postgres pool bounded vs. worker count (**PgBouncer** once workers scale out) so autoscaling workers don't exhaust connections.

---

## 7. Data model (sketch)

```
research_job(id, account_id, status, intent, coverage_target,
             credit_budget, credits_spent, created_at, finished_at)
sub_query(id, job_id, text, source_class, round, status)
result(id, job_id, sub_query_id, url, domain, title, snippet,
       content_ref→s3, content_hash, scores jsonb, rank, dedup_of)
coverage_report(job_id, domains_seen, source_classes_hit/missed,
                saturation_curve jsonb, gaps jsonb)
firecrawl_call(id, job_id, endpoint, status, latency_ms, credits, retries)
```

`firecrawl_call` doubles as the cost ledger and the debugging trail.

---

## 8. 72-hour demo scope vs. production

**Build now (demo):** the engine (①–⑤), the async Research API with webhook batch path, the Batch Console with live coverage view, the CLI, the rate-limited / retrying / idempotent Firecrawl client, a real nightly batch run of ~a few hundred queries with a coverage report. One language, demoable live in 45 min.

**Stub / sketch for prod (named, not built):** multi-tenant auth / billing, Terraform, horizontal worker autoscaling policy, the full intent-scorer model training — described in the one-pager, not coded.

---

## 9. What I deliberately won't build (and why)

- **LinkedIn (#10)** — policy-blocked, ToS / legal risk; wrong thing to demo to an employer.
- **BYO proxies (#2), fast snippet mode (#4), auth sessions (#11)** — **already exist** (`proxy:auto`, omit `scrapeOptions`, `profile` + `/interact`). Building these signals I didn't know the product. The one-pager will say *"these are config, not features — here's the exact param,"* which is itself the right answer to those customers.
- **Per-step action debugging (#7) and self-maintaining extractors (#9)** — genuinely good gaps, but each is its own deep product; bundling them makes this wide-and-shallow. Noted as the strongest next bets.

### The "AI got it wrong" hook (brief requirement #3)

The research pass surfaced a real one already — a source claimed Firecrawl's `/search` supports a custom-proxy URL param on the hosted API, and another floated a "Feb 2026" deep-research deprecation date. Both are wrong (BYO is self-host-only; deprecation was Jun 2025). The build is instrumented with the same skepticism: every Firecrawl param the engine depends on gets a **contract test against the live API** so an LLM-hallucinated parameter fails loudly in CI, not silently in a nightly batch.

---

## 10. Milestones (72h)

1. **H0–8** Firecrawl client chokepoint (Redis Lua rate-limiter + leased semaphore + retry + cache + cost meter) + contract tests; query-expansion leaf stage.
2. **H8–24** Coordinator/saturation controller (Postgres state machine) + fan-out + diversity-merge with atomic dedup/saturation sets + round barriers; coverage report. Engine works end-to-end on CLI.
3. **H24–40** Async API + hot/cold lanes + webhook batch path (idempotent + polling backstop) + idempotency / resume; Postgres / Redis / S3 wiring.
4. **H40–56** Batch Console with live streaming + coverage view; intent rerank (#5); thin MCP adapter over the API.
5. **H56–68** Real nightly batch run, harden retries / empties / slow-tails / poison-DLQ, polish demo.
6. **H68–72** One-pager + record fallback demo.

> Production-only (named, not built in 72h): port the coordinator to Temporal/Inngest, PgBouncer, per-tenant fair-share queuing, worker autoscaling policy.

---

## 11. Final architecture adjustments

Four refinements locked before any code is written — each closes a correctness or reviewability gap a senior reviewer would flag:

- **Hexagonal (ports & adapters).** The completeness algorithm (expansion → fan-out → merge → saturation → rerank) is **pure domain logic with zero I/O**. Firecrawl, the LLM, Postgres, Redis, and object storage sit behind **port interfaces**; concrete adapters are injected. The saturation logic becomes unit-testable with in-memory fakes — no network, no flakiness — which is the difference between "I tested the algorithm" and "I tested that the API was up."
- **Transactional outbox for events.** Job-state changes and the event that announces them are written in **one Postgres transaction** (state row + `outbox` row); a separate dispatcher publishes to the queue / SSE / webhooks. This removes the dual-write race where a crash between "DB committed" and "queue published" silently loses an event — critical when an event drop means a stalled batch.
- **Contract-first, one source of truth.** API shapes are defined once as **Zod schemas → OpenAPI + generated TS types**, shared across API, CLI, MCP server, and frontend. No hand-kept duplicate type definitions drifting apart. Firecrawl's surface lives behind its own typed contract with the live **contract tests** from §9.
- **Monorepo, explicit module boundaries** (pnpm workspaces) — see §13. Domain core depends on nothing; everything depends inward.

---

## 12. Engineering standards (what a reviewer will check)

**Language & types**
- TypeScript **strict** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). **`any` is banned**; use `unknown` + narrowing. No non-null `!` assertions outside tests.
- **Parse, don't validate**: every external input (HTTP body, webhook, Firecrawl response, env, LLM output) is parsed through a **Zod schema at the boundary**; the interior trusts types.

**Errors**
- **Typed, never swallowed.** Domain failures are modeled as a `Result<T, E>` (or tagged error union) for expected paths; exceptions only for truly exceptional/unrecoverable. Every error carries a stable `code`, `retryable: boolean`, and context. No bare `catch {}`; no `catch (e) { log(e) }` that then continues as if fine.
- One **error taxonomy** module shared by retry logic, the circuit breaker, and the coverage-gap reporter, so "why did this query fail" has exactly one vocabulary.

**Boundaries & purity**
- Side effects live in adapters; the domain core is pure and deterministic given inputs. **No `Date.now()` / `Math.random()` / direct env reads inside domain logic** — inject a clock and an id/seed source so runs are reproducible and testable.

**Config & secrets**
- 12-factor. All config validated through one Zod-checked `env` module **at startup — fail fast**, never read `process.env` ad hoc. **No secrets in code or git** (brief requirement); `.env.example` committed, `.env` git-ignored; pre-commit secret scan (gitleaks).

**Observability**
- Structured JSON logs only; every log and span carries a **correlation id** (`jobId` / `requestId`) propagated through the queue. Every external call (Firecrawl, LLM, DB) is a span with cost/credits as attributes. **No PII / no full page content / no credentials in logs.**

**Testing**
- **Test pyramid**: fast unit tests on the pure domain (the saturation loop, dedup, rerank scorers); integration tests on adapters against ephemeral Postgres/Redis (Testcontainers); **contract tests against live Firecrawl** gated to CI-with-key so hallucinated params fail loudly. Deterministic — injected clock/seed, no real sleeps (fake timers). Concurrency primitives (Lua limiter, leased semaphore, idempotency) get **explicit race tests** that hammer them in parallel.
- Tests named `it('returns a coverage gap when every expansion is empty')` — behavior, not method names.

**Tooling & process**
- **ESLint (typescript-eslint strict) + Prettier**, enforced in CI and pre-commit (husky + lint-staged). **Conventional Commits**; small, single-purpose PRs; CI gates = typecheck + lint + test + build, all green to merge.
- **ADRs** (`docs/adr/NNN-*.md`) for every decision already made here (deterministic core, hand-rolled coordinator, hot/cold split) so reviewers see the *why*, not just the *what*. **TSDoc** on every exported symbol; the *why* in comments, never the *what*.
- Dependencies: lockfile committed, `npm audit`/Dependabot, pin majors, prefer std-lib over micro-deps.

---

## 13. Design patterns & repository layout

**Patterns in play (and why each is here, not cargo-culted):**

| Pattern | Where | Why |
|---|---|---|
| Ports & Adapters (Hexagonal) | whole app | swappable Firecrawl/LLM/DB, testable pure core |
| Repository | persistence | domain speaks `ResearchJobRepo`, not SQL |
| Strategy | intent rerankers (`news`/`research`/`buying`) | pluggable scorers, open for extension (#5) |
| State machine | coordinator / saturation controller | explicit, durable, Temporal-portable round loop |
| Transactional Outbox | event publication | no lost events on crash |
| Circuit breaker + Token bucket + Leased semaphore | Firecrawl client | the §6a concurrency contract |
| Idempotency key | API + stages | exactly-once effect under retries |
| DTO ↔ Domain mapping | API/persistence edges | wire shape never leaks into domain |

```
velvet-comet/                 # pnpm monorepo
├─ packages/
│  ├─ core/        # PURE domain: completeness engine, scorers, coverage.
│  │              #   depends on NOTHING (no db, no http, no firecrawl SDK)
│  ├─ adapters/    # firecrawl client (chokepoint), llm, repos, cache, storage
│  ├─ contracts/   # Zod schemas → OpenAPI + generated types (one source of truth)
│  ├─ worker/      # BullMQ stage workers + coordinator runtime
│  ├─ api/         # Fastify HTTP + webhook receivers + SSE
│  ├─ mcp/         # thin MCP server over contracts (§5a)
│  ├─ cli/         # `vc research ...`
│  └─ web/         # Next.js Batch Console (§14)
├─ docs/adr/       # architecture decision records
└─ infra/          # docker-compose (demo), terraform sketch (prod)
```
Dependency rule (enforced by lint boundaries): **everything points inward to `core`; `core` points at nothing.**

---

## 14. Frontend & design system — the Batch Console

The console is the live-demo surface, so it has to be genuinely beautiful and *legible under data*, not a dashboard template. The product is "completeness you can trust," so the UI's whole job is to make coverage **feel** trustworthy and the batch **feel** under control.

**Aesthetic direction — "command center, after dark."** Leaning into the project name: a deep velvet-night canvas with a single comet-accent (a warm cyan→magenta gradient) used sparingly for the live/active state and the coverage signal. Calm and dense, not loud — an operator should be able to stare at it at 2am. Dark-first, with a real light theme (not an afterthought).

**Stack**
- **Next.js (App Router) + React + TypeScript**, **Tailwind** with a tokenized theme, **shadcn/ui (Radix primitives)** for accessible components, **Framer Motion** for restrained motion, **visx / Tremor** for the data-viz, **TanStack Query** for server state, **SSE** for live job streaming.

**Design tokens** — one source of truth (CSS variables + Tailwind theme): an 8-pt spacing grid, a restrained type scale (Inter / Geist for UI, a mono for ids/credits/code), semantic color roles (`surface`, `muted`, `accent`, `success`, `warn`, `danger`) so we never hardcode hex.

**The hero: the Coverage view.** This is what sells "completeness is the product":
- A **saturation curve** — new-domains-discovered per round, flattening to the stop point. Watching it asymptote *is* the proof we kept going until dry.
- A **source-class coverage grid** — web / news / trade / forum / regional — hit vs. missed, so an analyst sees the long tail we reached *and* the gaps we honestly couldn't.
- A **domain-diversity treemap** showing SEO-head vs. long-tail share — the visual rebuttal to "fifty results, forty more of the same."
- A live **cost meter** (credits this run) — trust + the "10× slower is fine, but show me what it costs" subtext.

**Interaction & state quality**
- **Every state is designed first**: empty (no jobs yet → a real first-run prompt), loading (skeletons, never spinners-on-blank), partial (batch still streaming, shown as such), error, and the honest **partial-success** state (job done, N gaps recorded) — never a fake-green "complete."
- Live job rows **stream in via SSE** with subtle enter motion; optimistic submit; per-row status that maps 1:1 to the coordinator's state machine (queued → expanding → fanning out → reranking → done/partial).
- **Keyboard-first** (cmd-K to launch a research run, j/k to move rows) — this is an operator tool.

**Non-negotiables**
- **WCAG 2.1 AA**: contrast, focus-visible rings, full keyboard nav, `prefers-reduced-motion` respected (motion is decoration, never the only signal). Responsive down to a laptop; the console is desktop-first by intent. Semantic HTML, Radix for the hard a11y bits.

---

## 15. Post-MVP improvement roadmap

The 72h slice is complete and durable. The next investments, prioritized by
leverage. The honest gap: the product *asserts* completeness but does not yet
*measure* it — so the eval harness comes first and gates everything after it.

**Tier 0 — make the claim measurable (do first)**
- **#0 Completeness eval harness. ✅ DONE** (`packages/eval`). Golden topics with a
  known ground-truth source universe; measures **recall@N**, source-class coverage,
  and head-vs-tail ratio — and the **lift over a flat `/search` baseline**
  (currently **+67%**: 100% engine recall vs. 33% flat). A regression-gated number,
  not an assertion.

**Tier 1 — quality (the core claim)**
- **#1 Semantic relevance in rerank. ✅ DONE.** `lexicalRelevance` blended
  `relevance × intent` in `rerank` (with a clear seam for an embedding scorer), so
  completeness never costs precision.
- **#2 Adaptive, content-aware expansion.** Feed round-N findings back into
  round-N+1 (entity extraction → targeted sub-queries); prune low-yield angles by
  new-domains-per-sub-query. A real strategy, not fixed-K.
- **#3 Real source classification.** Replace the substring heuristic in `text.ts`
  with a cached classifier so the diversity quota + coverage grid are trustworthy.

**Tier 2 — cost & scale (the batch promise)**
- **#4 Wire the cache. ✅ DONE.** A `SearchCache` port (in-memory TTL; Redis-
  swappable) in the chokepoint short-circuits repeat sub-queries at zero credits;
  the ledger now reports cache hits.
- **#5 Distributed limiter + real queue.** Redis Lua limiter + BullMQ so the
  hot/cold lanes hold across worker processes at batch scale.
- **#6 Cross-job knowledge base.** A queryable `results` table so new queries
  warm-start from prior coverage and the batch gets cheaper/more complete over time.

**Tier 3 — product surface**
- **#7 A real Batch Console. ✅ DONE.** Query-*set* submission (one per line), a
  job list streaming each run independently over its own SSE, a batch summary, and
  click-through to per-job coverage.
- **#8 Scheduled re-runs + change tracking.** Answers customer #9's
  "maintains itself": nightly re-run of saved topics, diff coverage via Firecrawl
  `changeTracking`, alert on new sources.
- **#9 Auth + per-tenant fair-share** on the budget/queue (§6a refinement).

**Tier 4 — robustness**
- **#10 OTel traces + Prometheus metrics** (named in §5, not yet wired).
- **#11 Optional content deepening** — scrape full content for top-N and extract
  structured summaries; budget-gated.

---

## Appendix — Firecrawl capability notes (verified, mid-2026 v2)

- **`/search`**: `limit` (default 10, max 100, per source). `sources: [web, news, images]`. No `scrapeOptions` ⇒ SERP-only snippets (~sub-second). `categories: [github, research, pdf]`. **No rerank / intent param.**
- **`/scrape` proxy**: `basic` | `enhanced` | `auto` (default; basic→enhanced fallback). **No BYO proxy on hosted API** (self-host env vars only).
- **Deep research**: `/v1/deep-research` deprecated/unmaintained after Jun 30 2025; replacement is self-orchestrated `/search` + `/scrape` (OSS ref: Firesearch).
- **`actions`**: no per-step error / index / timing; mid-chain failure ⇒ one generic error. Newer `/v2/scrape/{id}/interact` partially fills step-level visibility.
- **`/extract`**: stateless, one-shot; no managed / self-repairing extractors. Change detection lives on `/scrape` via `changeTracking`.
- **Markdown dedupe**: no repeated-block dedupe; only `onlyMainContent` / `onlyCleanContent` boilerplate stripping.
- **Sessions**: within-scrape via `actions` / `/interact`; cross-request via named `profile` (`saveChanges`, must stop session to persist). Creds via `headers`.
- **Batch / async**: `POST /v2/batch/scrape`, `POST /v2/crawl`, poll `GET .../{id}`; webhooks `crawl.*` / `batch_scrape.*` (2xx in 10s, retries 1/5/15 min).
- **Plans (rpm / concurrency)**: Free 10/2 · Hobby 100/5 · Standard 500/50 · Growth 5,000/100 · Scale 7,500/150.
- **SDKs**: Python `firecrawl-py` 4.30.x, Node `@mendable/firecrawl-js` 4.28.x. **FIRE-1** agent (Beta) via `agent: { model: "FIRE-1", prompt }` on `/scrape` & `/extract`.

*Items to confirm directly with Firecrawl before relying on them: exact `/search` `limit` SDK default, LinkedIn per-account policy, `crawl.failed` / `batch_scrape.failed` webhook events, FIRE-1 endpoint path on v2.*
