# ☄ Velvet Comet — Project Overview

**Completeness-first research on Firecrawl.** A research engine that surfaces the
sources a flat search never reaches — and proves it with a number.

This is the full walkthrough of the project: the problem, the decision, how it
works, how it's built, and how to run it. For the quick version see
[README.md](README.md); for the design rationale and the 11-feedback triage see
[PLAN.md](PLAN.md); for the brief's required write-up see [ONE-PAGER.md](ONE-PAGER.md).

---

## At a glance

| | |
|---|---|
| **What** | An orchestration engine over Firecrawl that maximizes *source completeness* for a research query, then ranks and (optionally) scrapes the best results. |
| **Headline result** | **+67% completeness lift** over a flat `/search` baseline (100% vs. 33% recall on a controlled corpus), measured by a built-in eval harness. |
| **Surfaces** | A CLI, an HTTP API with live SSE streaming, a Next.js "Batch Console", and a Temporal workflow port. |
| **Stack** | TypeScript (strict) · pnpm monorepo · Fastify · Next.js + Tailwind · Postgres · Temporal · Vitest. |
| **Quality** | 9 packages, 68 tests + 4 gated live-API tests, strict typecheck + lint clean. |
| **Composes** | Firecrawl `/search` (the fan-out) **and** `/scrape` (the deepen step). |

---

## 1. The problem

The brief contained 11 pieces of real customer feedback. The loudest and
highest-ARR voice — a competitive-intelligence platform ($180k, renewal at risk,
expansion gated on this) — said:

> *"Going from ten to fifty mostly gave us forty more of the same SEO winners.
> The sources we actually miss don't show up at any limit. … These run overnight
> as batch jobs, a few thousand queries a night. Make it ten times slower, I
> genuinely don't care."*

The reframing that drives the entire project:

> **Completeness is not a `limit` problem.** Raising `limit` returns more of the
> head. Completeness is a **query-coverage + source-diversity** problem.

Firecrawl deprecated its `/deep-research` endpoint in 2025 and told users to
"orchestrate `/search` yourself." Velvet Comet *is* that orchestration,
productized — and built batch-native, because that customer runs it overnight at
scale and explicitly trades latency for thoroughness.

## 2. The decision (why this problem)

Scored all 11 items on business weight (ARR + urgency), support cost, whether the
ask **already ships** (the brief warns: *"know the product before you build"*),
and demoability. The full table is in [PLAN.md §1](PLAN.md). The pick:

**Build the completeness engine for customer #1, with customer #5's intent-aware
reranking.** Reasons: highest ARR + active renewal risk; a *real gap* (deprecated
deep-research) not an already-shipping feature; a batch/throughput story that
rewards good systems design; and it composes multiple Firecrawl capabilities.

Crucially, the brief rewards **narrow and deep over wide and shallow** — so this
solves *one* customer's problem end-to-end rather than touching all eleven.

## 3. How the completeness engine works

The core is a bounded, *saturating* fan-out — it changes the **queries**, not the
result count:

```
query
  → ① EXPAND    one query → K angled sub-queries that target the source
                classes still missing (forum, trade press, regional, research…)
  → ② FAN OUT   each sub-query → Firecrawl /search across web + news,
                through a single rate-limited chokepoint
  → ③ MERGE     near-duplicate dedup (SimHash) + a per-domain quota, so the
                SEO head can't crowd out the long tail
  → ④ SATURATE  loop rounds until a full round surfaces ZERO new domains
                ("dry") — this is the lever the batch customer asked for
  → ⑤ RERANK    score each result by relevance × intent
                (news=freshness · research=authority · buying=comparison)
  → ⑥ DEEPEN    (optional) scrape full content for the top-N results
                — composes /search + /scrape
  → OUTCOME     ranked results + a coverage report:
                saturation curve · classes hit/missed · honest gaps · credits
```

Steps ① and ④ are what reach the trade pubs and niche forums that *don't appear
at any `limit`*: we vary the angle and keep going until the domain set stops
growing. The **coverage report** is the trust artifact — for a customer whose
"completeness is the product," it shows exactly what was covered, what was
honestly missed, and what it cost.

## 4. Architecture

A pnpm monorepo built **hexagonally**: a pure domain core with zero I/O, and all
side effects (Firecrawl, LLM, DB, queue) behind injected ports. The dependency
rule is enforced — *everything points inward to `core`; `core` depends on
nothing* — which is what makes the engine unit-testable without a network.

```
contracts → core → adapters → worker → api → web
                                         └→ temporal
                     core ← eval
```

| Package | Role |
|---|---|
| **`contracts`** | Zod schemas → inferred types. One source of truth across every package. |
| **`core`** | The **pure** completeness engine: expand → fan-out → diversity-merge → saturate → rerank → deepen. A `Result`/error taxonomy, ports, and resumable per-round state. No I/O. |
| **`adapters`** | Side effects: the Firecrawl **chokepoint** for `/search` and `/scrape` (token-bucket rate limiter + leased semaphore + retry-with-jitter + per-domain circuit breaker + cost ledger + response cache); Anthropic & heuristic query expansion; deterministic mocks; fail-fast env; structured logger. |
| **`worker`** | The durable **Coordinator**: per-round checkpointing (crash → resume with no re-spend), idempotent submit/process, hot/cold priority lanes. `JobStore` port with **in-memory and Postgres** implementations. |
| **`api`** | Fastify HTTP surface: `POST /v1/research` (hot inline / cold async), job status, **SSE** round-by-round progress, a Firecrawl webhook receiver. |
| **`web`** | Next.js **Batch Console** — "command center, after dark": query-set submission, a live-streaming job list, and the hero coverage view (saturation curve, source-class grid, diversity bar, live cost meter). |
| **`temporal`** | The Coordinator re-expressed as a **Temporal workflow** — durability becomes free (event-sourced), so the saturation loop is just plain code. |
| **`eval`** | The **completeness eval harness**: golden topics with known ground truth → recall@N, source-class coverage, and the lift over a flat-search baseline. |

## 5. The surfaces

- **CLI** — `vc research "<query>" [--intent …] [--coverage fast|standard|high] [--deepen]`. Prints a saturation sparkline and the coverage report. The fastest way to see the engine work.
- **API + SSE** — submit a run; `fast` coverage processes inline (hot lane), batch runs stream round-by-round over Server-Sent Events (cold lane).
- **Batch Console** — submit a *set* of queries (one per line); each becomes a job streaming independently; click any job for its full coverage view. The surface the nightly-batch customer actually needs.
- **Temporal port** — the same engine where Temporal handles durability and retries; the workflow loops, an activity does the I/O.
- **Eval harness** — `pnpm --filter eval eval` prints the completeness lift.

## 6. Reliability & scale engineering

The workload is bursty, embarrassingly parallel, and bottlenecked entirely on
Firecrawl's per-plan limits — so the design centers on a single chokepoint plus
durable orchestration:

- **One Firecrawl chokepoint** owns the budget: a Redis-swappable token-bucket
  (rpm) **and** a leased semaphore (in-flight concurrency, TTL-reclaimed), so
  autoscaling workers can never trigger 429 storms.
- **Retries with jitter + per-domain circuit breaker**, so one flaky domain can't
  burn the whole batch's budget. Failures become *coverage gaps*, never fatal.
- **Durable, resumable rounds** — the Coordinator checkpoints engine state after
  every round; a crash resumes from the last checkpoint instead of re-spending
  credits (proven by a crash/resume test that asserts round 1 is never re-run).
- **Idempotency** — submit is keyed; re-processing a terminal job is a no-op.
- **Response cache** — identical sub-queries across a batch are served at zero
  credits; the cost ledger reports the hits.
- **Hot/cold lanes** — interactive requests get budget priority over batch.
- **Live contract tests** — gated tests validate *real* Firecrawl responses
  against the exact schema the code trusts, so a drifted/hallucinated parameter
  fails in CI, not in a nightly batch.

## 7. Measuring completeness (the credibility centerpiece)

The product *asserts* completeness; the **eval harness** *measures* it. Golden
topics define a known universe of sources, with long-tail sources gated behind
specific query angles. We then compare the engine against a flat `/search`
baseline:

```
topic            truth  baseline  engine   lift   classes
iot-sensors        9     33%      100%   +67%    100%
ev-supply          9     33%      100%   +67%    100%
fintech-reg        9     33%      100%   +67%    100%
AVERAGE                  33%      100%   +67%    100%
→ the engine surfaces 67% more of the known sources than a flat search.
```

This is gated by tests, so it's a regression metric — not a one-off claim.

## 8. Quality & engineering standards

- **Strict TypeScript** everywhere (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, no `any`), with parse-don't-validate at every
  boundary via Zod.
- **Typed errors**, never swallowed — one shared error taxonomy drives retries,
  the circuit breaker, and the gap reporter.
- **Pure, deterministic core** — no `Date.now()`/`Math.random()` inside domain
  logic; clocks and ids are injected, so runs are reproducible and testable.
- **Test pyramid** — fast unit tests on the pure engine, race tests on the
  concurrency primitives, integration tests (incl. Postgres via `pg-mem`), and
  gated live contract tests.
- **Gates:** `pnpm typecheck` · `pnpm lint` · `pnpm test` — all green.

## 9. Running it

Offline, no keys needed (deterministic mock search + heuristic expansion):

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install

# CLI:
pnpm --filter @velvet-comet/cli research \
  "competitive landscape for industrial IoT sensors" --coverage high --deepen

# Full stack:
pnpm --filter @velvet-comet/api start    # http://localhost:3000
pnpm --filter @velvet-comet/web dev      # http://localhost:4321

# The completeness number:
pnpm --filter @velvet-comet/eval eval
```

Live mode: set `FIRECRAWL_API_KEY` (real `/search` + `/scrape`),
`ANTHROPIC_API_KEY` (LLM expansion), and/or `DATABASE_URL` (durable jobs) in
`.env`. Full commands are in [docs/DEV.md](docs/DEV.md).

## 10. What I deliberately did NOT build — and why

- **LinkedIn at scale** — policy-blocked by Firecrawl, ToS/legal risk.
- **Asks that already ship** — fast snippet-only search (omit `scrapeOptions`),
  BYO/auto proxy retries (`proxy: auto`), authenticated sessions (`profile` +
  `/interact`). Building these would signal not knowing the product; the right
  answer is "that's config — here's the exact param."
- **Per-step action debugging & self-maintaining extractors** — strong gaps, but
  each is its own deep product. Bundling them = wide-and-shallow.
- **Production ops** — multi-tenant auth/billing, autoscaling, distributed queue.
  The *interfaces* exist; the ops are scoped out of a focused build, not
  hand-waved. (Full roadmap in [PLAN.md §15](PLAN.md).)

## 11. What AI got wrong — and how I caught it

- **Research:** an agent surveying Firecrawl's API returned two wrong "facts" (a
  hosted custom-proxy param; a fabricated deprecation date). Caught by requiring
  citations + cross-checking primary docs — and defended systemically by the live
  contract tests.
- **Code (caught by a failing test):** an AI-written test fixture generated
  near-identical content for distinct mock results, so the SimHash dedup
  (correctly) collapsed them and a quota test failed. The test was right and the
  *fixture* was wrong — fixed the generator, not the test. Exactly why the engine
  is a pure, injectable core: bugs surface in a millisecond unit test, not a
  credit-burning batch.

## 12. Status

The full vertical slice is **production-durable and demoable end-to-end**:
contracts → pure engine → Firecrawl chokepoint (`/search` + `/scrape`) → durable
coordinator (Postgres) → API (SSE) → Batch Console, plus a Temporal deployment
path, an eval harness, and a CI-grade live-contract gate. The next investments
(adaptive expansion, distributed queue, scheduled monitoring) are tracked in
[PLAN.md §15](PLAN.md).

---

### Document map

| Doc | What it is |
|---|---|
| [README.md](README.md) | Concise landing page + quickstart. |
| **OVERVIEW.md** (this) | Full project walkthrough. |
| [PLAN.md](PLAN.md) | Design rationale, the 11-feedback triage, standards, roadmap. |
| [ONE-PAGER.md](ONE-PAGER.md) | The brief's required write-up. |
| [docs/DEV.md](docs/DEV.md) | Developer guide / run commands. |
| [docs/BRIEF.md](docs/BRIEF.md) | The original assignment brief. |
