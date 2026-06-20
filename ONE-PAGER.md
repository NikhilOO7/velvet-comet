# Velvet Comet — one-pager

## What I built

A **completeness-first research engine on Firecrawl**, productized across a CLI, an HTTP API (with live SSE), and a Next.js console. It targets the highest-stakes voice in the brief — the $180k competitive-intel customer whose *"completeness is the product"* and whose deprecated `/deep-research` workflow left a real gap.

The core reframing: **completeness is not a `limit` problem.** Raising `limit` returns more of the SEO head; the trade pubs, regional press, and niche forums analysts miss don't appear at any limit. So the engine changes the *queries*, not the result count:

1. **Expand** a query into K angled sub-queries that target the source classes still missing.
2. **Fan out** across web + news through a single rate-limited Firecrawl chokepoint.
3. **Diversity-merge** — near-duplicate dedup (SimHash) + a per-domain quota so the head can't dominate.
4. **Saturate** — loop rounds until a round surfaces **zero new domains** ("10× slower is fine — nobody's watching a spinner").
5. **Rerank** by declared intent (freshness / authority / comparison), and emit a **coverage report**: the saturation curve, source classes hit vs. missed, honest gaps, and credit cost.

It composes two Firecrawl capabilities — `/search` (the fan-out) and `/scrape` (the optional deepen step that pulls full content for the top results) — and handles the messy parts the brief names — retries, slow tails, empty results, dedup — behind a chokepoint with a token-bucket + leased semaphore + circuit breaker. It's **durable** (per-round checkpointing → crash/resume with no re-spend; in-memory **or** Postgres), runs **hot/cold lanes** (interactive vs. nightly batch), and ships a **Temporal port** where durability comes for free. 68 tests, all 9 packages strict-typed and lint-clean.

## What I deliberately did NOT build — and why

- **LinkedIn at scale (#10)** — policy-blocked by Firecrawl, ToS/legal risk. Wrong thing to demo.
- **Features that already ship.** The brief warned about this, so I verified the product first and *refused to rebuild*:
  - "Fast, snippets-only, 3 results" (#4) → already exists: omit `scrapeOptions` → SERP-only ~sub-second.
  - "BYO proxies / make failures go away" (#2) → `proxy: auto` already retries basic→enhanced.
  - "Authenticated sessions across steps" (#11) → already exists via the `profile` + `/interact` primitives.
- **Per-step action debugging (#7) and self-maintaining extractors (#9)** — genuinely good gaps, but each is its own deep product. Bundling them would make this wide-and-shallow; the brief explicitly rewards the opposite. Noted as the strongest next bets.
- **Production infra I named but stubbed** — multi-tenant auth/billing, worker autoscaling, the deeper token-budget arbiter. The *interfaces* exist (e.g. the `JobStore` port has both in-memory and Postgres impls); the ops are scoped out of a 72h build, not hand-waved.

Narrow and deep: one customer's problem, solved end to end, durable and demoable.

## One thing my AI tools got wrong — and how I caught it

**Two, honestly — one per layer.**

**Research layer.** While I had an agent survey Firecrawl's current API, two "facts" came back wrong: that the hosted `/search` accepts a custom-proxy URL param (it doesn't — BYO proxy is self-host only), and a fabricated "Feb 2026" deep-research deprecation date (the real one is June 2025). I caught these because I'd *told the agent to cite primary docs and flag uncertainty*, then cross-checked the load-bearing claims against docs.firecrawl.dev myself. The systemic defense is in the repo: **gated live contract tests** that validate real Firecrawl responses against the exact Zod schema the adapter trusts — so a hallucinated or drifted parameter fails loudly in CI, not silently in a nightly batch.

**Code layer (caught live by a test).** My AI-written test fixture generated near-identical default content for distinct mock results. The SimHash near-duplicate collapser — working *correctly* — ate them, and the per-domain-quota test failed: it expected 2 results from a domain but got 1. The instinct is to "fix the test." The failing test was right and the *fixture* was wrong: identical content **should** dedupe. I fixed the generator to produce maximally-distinct content so distinct items stay distinct, and the dedup tests still pin the real behavior. That's the whole reason the engine's logic is a pure, dependency-injected core — so this kind of bug surfaces in a millisecond unit test instead of a credit-burning batch run.
