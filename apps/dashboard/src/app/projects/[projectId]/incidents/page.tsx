'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Environment, IncidentStatus, IncidentSummary } from '@rootly.ai/shared';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

const STATUS_FILTERS: IncidentStatus[] = ['OPEN', 'RESOLVED', 'IGNORED'];
const SORTS = ['Most Recent', 'Occurrence Count'] as const;
type Sort = (typeof SORTS)[number];

const STATUS_DOT: Record<IncidentStatus, string> = {
  OPEN: '🔴',
  RESOLVED: '🟢',
  IGNORED: '⚪',
};

export default function ProjectIncidentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentId, setEnvironmentId] = useState('');
  const [status, setStatus] = useState<IncidentStatus>('OPEN');
  const [sort, setSort] = useState<Sort>('Most Recent');
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [envs, page] = await Promise.all([
        environments.length ? Promise.resolve(environments) : api.listEnvironments(projectId),
        api.listIncidents(projectId, { environmentId: environmentId || undefined, status, limit: 100 }),
      ]);
      setEnvironments(envs);
      setIncidents(page.data);
      setTotal(page.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId, status]);

  const sorted = useMemo(() => {
    const list = [...incidents];
    if (sort === 'Occurrence Count') list.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
    return list;
  }, [incidents, sort]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Incidents</h1>
          <p className="mt-1 text-sm text-black/50 dark:text-white/50">{total} total</p>
        </div>
        <div className="flex gap-3">
          <select
            className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
            value={environmentId}
            onChange={(e) => setEnvironmentId(e.target.value)}
          >
            <option value="">All environments</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
            value={status}
            onChange={(e) => setStatus(e.target.value as IncidentStatus)}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="text-sm text-black/50 dark:text-white/50">Loading...</p>}

      {!loading && sorted.length === 0 && (
        <p className="text-sm text-black/50 dark:text-white/50">No incidents match this filter.</p>
      )}

      <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
        {sorted.map((incident) => (
          <Link
            key={incident.id}
            href={`/incidents/${incident.id}`}
            className="flex flex-col gap-2 px-4 py-4 hover:bg-black/5 dark:hover:bg-white/5"
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-mono text-sm font-semibold">
                <span>{STATUS_DOT[incident.status]}</span>
                {incident.status}
                <span className="text-black/40 dark:text-white/40">INC-{incident.sequenceNumber}</span>
              </span>
              <span className="text-xs text-black/40 dark:text-white/40">
                Last seen: {formatRelativeTime(incident.lastSeenAt)}
              </span>
            </div>
            <p className="font-mono text-sm font-semibold text-red-600">{incident.errorName}</p>
            <p className="truncate text-sm text-black/70 dark:text-white/70">{incident.errorMessage}</p>
            <div className="flex gap-4 text-xs text-black/50 dark:text-white/50">
              <span>{incident.environment.name}</span>
              <span>{incident.occurrenceCount} occurrences</span>
              <span>First seen: {formatRelativeTime(incident.firstSeenAt)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
