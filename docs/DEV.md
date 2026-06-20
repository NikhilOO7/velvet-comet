# Velvet Comet — developer guide

Completeness-first research engine on Firecrawl. See [PLAN.md](../PLAN.md) for the
why; this is how to run what's built so far.

## Layout (PLAN.md §13)

```
packages/
  contracts/   Zod schemas → types. One source of truth. Depends on nothing.
  core/        PURE completeness engine: expansion → fan-out → diversity-merge →
               saturation → intent rerank. No I/O. Fully unit-tested.
  adapters/    Side effects: Firecrawl chokepoint (rate limit + leased semaphore +
               retry + circuit breaker + cost ledger), Anthropic/heuristic
               expansion, mock search, env, logger.
  worker/      Durable Coordinator: per-round checkpointing (crash → resume, no
               re-spend), idempotent submit/process, hot/cold priority lanes.
               JobStore port + in-memory AND Postgres impls (tested via pg-mem).
  api/         Fastify HTTP surface: POST /v1/research (hot inline / cold async),
               GET status, SSE progress stream, Firecrawl webhook receiver.
  web/         Next.js Batch Console — "command center, after dark". Hero
               coverage view (saturation curve, source-class grid, diversity bar,
               cost meter), live SSE streaming, all UI states designed.
  temporal/    The Coordinator as a Temporal workflow + activities. Durability is
               free (event-sourced); the saturation loop is plain code.
  eval/        Completeness eval harness: golden topics + recall@N vs. a flat
               /search baseline. `pnpm --filter eval eval` prints the lift.
  cli/         `vc research` — composition root + terminal renderer.
```

Dependency rule: everything points inward to `core`; `core` points at nothing.

## Setup

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install
cp .env.example .env        # optional — runs offline without keys
```

## Run

```bash
# Offline (deterministic mock search + heuristic expansion):
pnpm --filter @velvet-comet/cli research \
  "competitive landscape for industrial IoT sensors" --coverage high

# Live: set FIRECRAWL_API_KEY (+ optionally ANTHROPIC_API_KEY) in .env first.

# API server (in-memory store):
pnpm --filter @velvet-comet/api start          # → http://localhost:3000
# Durable: set DATABASE_URL=postgres://… and the API auto-creates the schema
# and persists jobs (survives restarts). /health reports store=postgres|memory.
#   POST /v1/research            {"query":"...","coverage":"fast|standard|high"}
#   GET  /v1/research/:id         current state + outcome
#   GET  /v1/research/:id/stream  SSE round-by-round progress
#   GET  /health

# Batch Console (needs the API running):
pnpm --filter @velvet-comet/web dev            # → http://localhost:4321
#   NEXT_PUBLIC_API_BASE defaults to http://localhost:3000

# Temporal port (needs a Temporal dev server: `temporal server start-dev`):
pnpm --filter @velvet-comet/temporal worker    # host workflow + activities
pnpm --filter @velvet-comet/temporal start "your query" high   # trigger a run
```

Flags: `--intent news|research|buying|general`, `--coverage fast|standard|high`,
`--max-rounds N`, `--budget CREDITS`.

## Quality gates

```bash
pnpm typecheck   # strict TS, all packages
pnpm lint        # eslint type-checked, no `any` / no floating promises
pnpm test        # vitest: pure-core + concurrency-primitive race tests

# Live contract tests against real Firecrawl v2 (PLAN.md §9). Gated: skip unless
# a key is present, so a hallucinated/changed param fails loudly in CI only.
RUN_LIVE_CONTRACT_TESTS=true FIRECRAWL_API_KEY=fc-... pnpm test:contract
```

## Status

Built: contracts, pure engine (+19 tests), the chokepoint and concurrency
primitives (+14 tests), durable coordinator + hot/cold lanes (+5 tests), async
API with SSE (+8 tests), the Batch Console (Next.js), CLI, and gated live
Firecrawl contract tests (+4, skipped without a key), a Postgres JobStore (+5, via
pg-mem) wired into the API behind DATABASE_URL, and the Temporal coordinator port
(+2). Post-MVP (PLAN.md §15): a completeness **eval harness** (+3, recall vs.
baseline), **semantic relevance** in rerank (+1), a **response cache** in the
chokepoint (+5), a real **Batch Console** (query-set submission), and a **deepen**
step that composes `/search` + `/scrape` (+6). **68 passing / 4 gated**; all 10
packages typecheck + lint clean; `next build` green.
