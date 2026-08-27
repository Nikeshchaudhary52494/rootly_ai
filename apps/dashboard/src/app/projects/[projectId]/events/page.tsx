'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Environment, ErrorEventSummary } from '@incident-ai/shared';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

export default function ProjectEventsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [events, setEvents] = useState<ErrorEventSummary[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentId, setEnvironmentId] = useState<string>('');
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [envs, page] = await Promise.all([
        environments.length ? Promise.resolve(environments) : api.listEnvironments(projectId),
        api.listEvents(projectId, { environmentId: environmentId || undefined, limit: 50 }),
      ]);
      setEnvironments(envs);
      setEvents(page.data);
      setTotal(page.pagination.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Error Events</h1>
          <p className="mt-1 text-sm text-black/50 dark:text-white/50">{total} total</p>
        </div>
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
      </div>

      {loading && <p className="text-sm text-black/50 dark:text-white/50">Loading...</p>}

      {!loading && events.length === 0 && (
        <p className="text-sm text-black/50 dark:text-white/50">
          No error events yet. Trigger an error in an app using the SDK to see it here.
        </p>
      )}

      <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
        {events.map((event) => (
          <Link
            key={event.id}
            href={`/events/${event.id}`}
            className="flex flex-col gap-2 px-4 py-4 hover:bg-black/5 dark:hover:bg-white/5"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-semibold text-red-600">{event.errorName}</span>
              <span className="text-xs text-black/40 dark:text-white/40">
                {formatRelativeTime(event.timestamp)}
              </span>
            </div>
            <p className="truncate text-sm text-black/70 dark:text-white/70">{event.errorMessage}</p>
            <div className="flex gap-4 text-xs text-black/50 dark:text-white/50">
              <span>
                Service: <span className="font-mono">{event.serviceName}</span>
              </span>
              <span>
                Environment: <span className="font-mono">{event.environmentName}</span>
              </span>
              {event.release && (
                <span>
                  Release: <span className="font-mono">{event.release}</span>
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
