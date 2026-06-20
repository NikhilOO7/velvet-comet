/**
 * Typed client for the Research API. Reuses the contracts package for outcome
 * types so the console and server never drift (PLAN.md §11 contract-first).
 */
import type { CoverageProfile, Intent, ResearchOutcome } from '@velvet-comet/contracts';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000';

/** Compact streaming frame emitted per checkpoint (mirrors api/views.ts). */
export interface ProgressFrame {
  id: string;
  status: string;
  round: number;
  domainsSeen: number;
  newDomainsLastRound: number;
  creditsSpent: number;
  outcome?: ResearchOutcome;
  error?: { code: string; message: string };
}

export interface SubmitResponse {
  id?: string;
  deduped?: boolean;
  status: string;
  stream?: string;
  outcome?: ResearchOutcome;
  error?: string;
  issues?: string[];
}

/** Client submit shape — server applies defaults for omitted intent/coverage. */
export interface SubmitInput {
  query: string;
  intent?: Intent;
  coverage?: CoverageProfile;
  deepen?: boolean;
}

export async function submitResearch(input: SubmitInput): Promise<SubmitResponse> {
  const res = await fetch(`${API_BASE}/v1/research`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await res.json()) as SubmitResponse;
}

export function streamUrl(jobId: string): string {
  return `${API_BASE}/v1/research/${jobId}/stream`;
}
