/**
 * Runs each golden topic through (a) a flat `/search` baseline and (b) the full
 * completeness engine, and reports the recall lift (PLAN.md §15 #0). The lift is
 * the number that makes "completeness is the product" defensible.
 */
import type { CoverageProfile } from '@velvet-comet/contracts';
import { type EngineDeps, runCompleteness, isOk } from '@velvet-comet/core';
import { HeuristicExpansion, createLogger } from '@velvet-comet/adapters';
import { FixtureSearch, type EvalTopic } from './corpus.js';
import { TOPICS } from './topics.js';
import { domainsOf, headTailRatio, recall, sourceClassCoverage } from './metrics.js';

export interface TopicReport {
  id: string;
  truthSize: number;
  baselineRecall: number;
  engineRecall: number;
  lift: number;
  classCoverage: number;
  headTail: number;
  rounds: number;
  credits: number;
}

export interface EvalReport {
  perTopic: TopicReport[];
  aggregate: { baselineRecall: number; engineRecall: number; lift: number; classCoverage: number };
}

const BASELINE_LIMIT = 50; // a generous flat search — "limit at fifty" (customer #1)

function depsFor(topic: EvalTopic): EngineDeps {
  return {
    search: new FixtureSearch(topic),
    expansion: new HeuristicExpansion(),
    clock: { now: () => 0 },
    logger: createLogger('eval', () => undefined),
  };
}

export async function evaluateTopic(
  topic: EvalTopic,
  coverage: CoverageProfile = 'high',
): Promise<TopicReport> {
  // Baseline: a single flat search of the bare query at a high limit.
  const flat = await new FixtureSearch(topic).search({ query: topic.query, limit: BASELINE_LIMIT, round: 1 });
  const baselineDomains = isOk(flat) ? domainsOf(flat.value) : new Set<string>();
  const baselineRecall = recall(baselineDomains, topic.groundTruth);

  // Engine: expand → fan out → diversify → saturate.
  const result = await runCompleteness(
    { query: topic.query, intent: topic.intent, coverage, deepen: false },
    depsFor(topic),
  );
  if (!isOk(result)) {
    return { id: topic.id, truthSize: topic.groundTruth.length, baselineRecall, engineRecall: 0, lift: -baselineRecall, classCoverage: 0, headTail: 0, rounds: 0, credits: 0 };
  }
  const { results, coverage: cov } = result.value;
  const engineDomains = domainsOf(results);
  const engineRecall = recall(engineDomains, topic.groundTruth);

  return {
    id: topic.id,
    truthSize: topic.groundTruth.length,
    baselineRecall,
    engineRecall,
    lift: engineRecall - baselineRecall,
    classCoverage: sourceClassCoverage(engineDomains, topic.groundTruth),
    headTail: headTailRatio(results),
    rounds: cov.rounds,
    credits: cov.creditsSpent,
  };
}

export async function evaluate(topics: readonly EvalTopic[] = TOPICS): Promise<EvalReport> {
  const perTopic = await Promise.all(topics.map((t) => evaluateTopic(t)));
  const avg = (pick: (r: TopicReport) => number): number =>
    perTopic.length === 0 ? 0 : perTopic.reduce((s, r) => s + pick(r), 0) / perTopic.length;
  return {
    perTopic,
    aggregate: {
      baselineRecall: avg((r) => r.baselineRecall),
      engineRecall: avg((r) => r.engineRecall),
      lift: avg((r) => r.lift),
      classCoverage: avg((r) => r.classCoverage),
    },
  };
}
