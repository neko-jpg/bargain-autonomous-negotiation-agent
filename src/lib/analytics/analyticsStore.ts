import { randomUUID } from 'node:crypto';
import { AgentRunRecord } from '@/types/negotiation';
import { getDatabasePool } from '@/lib/negotiation/persistence';

interface AnalyticsState {
  runs?: AgentRunRecord[];
}

const globalState = globalThis as typeof globalThis & { __bargainAnalytics?: AnalyticsState };
const state = (globalState.__bargainAnalytics ??= {});
const runs = (state.runs ??= []);

export function recordAgentRun(input: Omit<AgentRunRecord, 'id' | 'createdAt'>) {
  const record: AgentRunRecord = {
    ...input,
    id: `agent-run-${randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
  runs.push(record);
  if (runs.length > 500) runs.splice(0, runs.length - 500);
  const database = getDatabasePool();
  if (database) {
    void database.query(
      `insert into negotiation_agent_runs
       (id, negotiation_id, provider, model, latency_ms, fallback, candidate_count, selected_candidate, guardrail_corrections, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing`,
      [record.id, record.negotiationId, record.provider, record.model ?? null, record.latencyMs, record.fallback, record.candidateCount, record.selectedCandidate, record.guardrailCorrections, new Date(record.createdAt)]
    ).catch((error: unknown) => console.warn('Agent run telemetry persistence failed:', error));
  }
  return record;
}

export function getAgentRunRecords() {
  return runs.slice();
}

export async function getAnalyticsOverview() {
  const database = getDatabasePool();
  if (database) {
    const result = await database.query(
      `select count(*)::int as total,
        coalesce(round(avg(latency_ms)), 0)::int as latency,
        coalesce(round(avg(candidate_count)::numeric, 1), 0)::float as candidates,
        coalesce(round(avg(case when fallback then 1 else 0 end)::numeric * 100, 1), 0)::float as fallback_rate,
        coalesce(sum(guardrail_corrections), 0)::int as corrections
       from negotiation_agent_runs where created_at >= now() - interval '30 days'`
    );
    const row = result.rows[0];
    return {
      totalAgentRuns: Number(row?.total ?? 0),
      averageLatencyMs: Number(row?.latency ?? 0),
      fallbackRate: Number(row?.fallback_rate ?? 0),
      averageCandidates: Number(row?.candidates ?? 0),
      guardrailCorrections: Number(row?.corrections ?? 0),
    };
  }
  const recent = runs.slice(-100);
  const total = recent.length;
  return {
    totalAgentRuns: total,
    averageLatencyMs: total ? Math.round(recent.reduce((sum, item) => sum + item.latencyMs, 0) / total) : 0,
    fallbackRate: total ? Math.round((recent.filter((item) => item.fallback).length / total) * 1000) / 10 : 0,
    averageCandidates: total ? Math.round((recent.reduce((sum, item) => sum + item.candidateCount, 0) / total) * 10) / 10 : 0,
    guardrailCorrections: recent.reduce((sum, item) => sum + item.guardrailCorrections, 0),
  };
}
