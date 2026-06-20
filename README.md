# ☄ Velvet Comet

**Completeness-first research on Firecrawl.** Coverage you can trust — not just more results.

> Built for the Firecrawl product-engineer brief ([docs/BRIEF.md](docs/BRIEF.md)).
> Full project walkthrough: [OVERVIEW.md](OVERVIEW.md). Design rationale: [PLAN.md](PLAN.md). The brief's required write-up: [ONE-PAGER.md](ONE-PAGER.md).

---

## The problem it solves

From the loudest, highest-ARR customer in the brief (competitive-intel platform, $180k, renewal at risk):

> *"Going from ten to fifty mostly gave us forty more of the same SEO winners. The sources we actually miss don't show up at any limit."*

The insight that drives everything here:

> **Completeness is not a `limit` problem.** Raising `limit` returns more of the head. Completeness is a *query-coverage + source-diversity* problem.

Firecrawl deprecated its `/deep-research` endpoint in 2025 and pointed users at "orchestrate `/search` yourself." Velvet Comet *is* that orchestration, productized: it expands a query into diverse angles, fans out across sources, dedupes the SEO head, and **keeps going until new domains stop appearing** — then reranks for the caller's intent and hands back a coverage report you can defend to a client.

## What it does

```
query → ① expand into K angled sub-queries (target the missing source classes)
      → ② fan out across web + news (rate-limited Firecrawl /search chokepoint)
      → ③ diversity-merge (near-dup dedup + per-domain quota — kills the head)
      → ④ saturate: loop rounds until a round surfaces 0 new domains (dry)
      → ⑤ rerank by relevance × intent (news=freshness · research=authority · buying=comparison)
      → ⑥ deepen (optional): scrape full content for the top results (/search + /scrape)
      → results + a coverage report (saturation curve, classes hit/missed, honest gaps, credits)
```

## Architecture

A pnpm monorepo, hexagonal (pure core, side-effects at the edges). Everything points inward to `core`; `core` depends on nothing.

```
contracts → core → adapters → worker → api → web
                                         └→ temporal
```

| Package | Role |
|---|---|
| `contracts` | Zod schemas → types. One source of truth. |
| `core` | **Pure** completeness engine: expand → fan-out → diversity-merge → saturate → rerank → deepen. No I/O. |
| `adapters` | Firecrawl **chokepoint** for `/search` and `/scrape` (token-bucket + leased semaphore + retry + circuit breaker + cost ledger + cache), Anthropic/heuristic expansion, mocks, env, logger. |
| `worker` | Durable **Coordinator**: per-round checkpointing (crash → resume, no re-spend), hot/cold lanes; in-memory **and** Postgres `JobStore`. |
| `api` | Fastify: `POST /v1/research` (hot inline / cold async), status, **SSE** progress, webhook receiver. |
| `web` | Next.js **Batch Console** — "command center, after dark": saturation curve, source-class grid, diversity bar, live cost meter. |
| `temporal` | The Coordinator as a Temporal workflow — durability becomes free (event-sourced); the loop is just code. |

Full design + the 11-feedback triage that picked this problem: **[PLAN.md](PLAN.md)**.

## Quickstart (offline — no keys needed)

The mock search + heuristic expansion make the whole system runnable deterministically offline.

```bash
corepack enable && corepack prepare pnpm@9.15.0 --activate
pnpm install

# CLI — the fastest way to see the engine work:
pnpm --filter @velvet-comet/cli research \
  "competitive landscape for industrial IoT sensors" --coverage high

# Full stack — API + console:
pnpm --filter @velvet-comet/api start          # http://localhost:3000
pnpm --filter @velvet-comet/web dev            # http://localhost:4321
```

The CLI prints a saturation sparkline (`█▅▁`) and the coverage report; the console streams it live.

## Live mode

Set keys in `.env` (copy from `.env.example` — **never commit `.env`**):

```
FIRECRAWL_API_KEY=fc-...      # real /v2/search
ANTHROPIC_API_KEY=sk-ant-...  # LLM query expansion (else heuristic)
DATABASE_URL=postgres://…     # durable jobs (else in-memory); /health reports which
```

## Tested & verified

```bash
pnpm typecheck   # strict TS across all 9 packages
pnpm lint        # eslint type-checked: no `any`, no floating promises
pnpm test        # 68 passing (pure-engine, deepen, concurrency races, crash/resume, API, Postgres, eval)
pnpm test:contract   # gated LIVE Firecrawl contract tests (needs a key)
```

Highlights worth a look: a **crash/resume test** proving a round is never re-spent ([coordinator.test.ts](packages/worker/src/coordinator.test.ts)), **leased-semaphore race tests** ([rate-limit.test.ts](packages/adapters/src/rate-limit.test.ts)), and **live contract tests** that validate the real Firecrawl response against the exact schema the code trusts ([firecrawl-contract.test.ts](packages/adapters/src/firecrawl-contract.test.ts)).

## More

- **[OVERVIEW.md](OVERVIEW.md)** — the full project walkthrough (problem → engine → architecture → how to run).
- **[PLAN.md](PLAN.md)** — the decision, architecture, standards, design patterns, frontend system.
- **[ONE-PAGER.md](ONE-PAGER.md)** — what I built, what I deliberately didn't, and what AI got wrong.
- **[docs/DEV.md](docs/DEV.md)** — developer guide / run commands.
