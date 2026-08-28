'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { IncidentDetail, IncidentStatus } from '@incident-ai/shared';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

const STATUS_BADGE: Record<IncidentStatus, string> = {
  OPEN: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  RESOLVED: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  IGNORED: 'bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60',
};

export default function IncidentDetailPage({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}) {
  const { incidentId } = use(params);
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  async function load() {
    try {
      setIncident(await api.getIncident(incidentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load incident');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  async function setStatus(status: IncidentStatus) {
    setUpdating(true);
    try {
      setIncident(await api.updateIncidentStatus(incidentId, status));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update incident');
    } finally {
      setUpdating(false);
    }
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!incident) return <p className="text-sm text-black/50 dark:text-white/50">Loading...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/projects/${incident.projectId}/incidents`}
          className="text-sm text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
        >
          ← Incidents
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="font-mono text-xl font-semibold">{incident.title}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[incident.status]}`}>
            {incident.status}
          </span>
          <span className="text-sm text-black/40 dark:text-white/40">INC-{incident.sequenceNumber}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          disabled={updating || incident.status === 'RESOLVED'}
          onClick={() => setStatus('RESOLVED')}
          className="rounded-md border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
        >
          Resolve
        </button>
        <button
          disabled={updating || incident.status === 'IGNORED'}
          onClick={() => setStatus('IGNORED')}
          className="rounded-md border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
        >
          Ignore
        </button>
        <button
          disabled={updating || incident.status === 'OPEN'}
          onClick={() => setStatus('OPEN')}
          className="rounded-md border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
        >
          Reopen
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-black/10 p-4 text-sm dark:border-white/10 sm:grid-cols-3">
        <Field label="Environment" value={incident.environment.name} />
        <Field label="Occurrences" value={String(incident.occurrenceCount)} />
        <Field label="Error type" value={incident.errorName} mono />
        <Field label="First seen" value={formatRelativeTime(incident.firstSeenAt)} />
        <Field label="Last seen" value={formatRelativeTime(incident.lastSeenAt)} />
        <Field label="Fingerprint" value={incident.fingerprint.slice(0, 12)} mono />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Error Message</h2>
        <p className="rounded-lg bg-black/5 p-4 text-sm dark:bg-white/10">{incident.errorMessage}</p>
      </div>

      {incident.latestEvent?.stackTrace && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Stack Trace (latest event)</h2>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-4 font-mono text-xs leading-relaxed dark:bg-white/10">
            {incident.latestEvent.stackTrace}
          </pre>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Recent Events</h2>
        <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
          {incident.recentEvents.map((event) => (
            <Link
              key={event.id}
              href={`/events/${event.id}`}
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-black/5 dark:hover:bg-white/5"
            >
              <span className="truncate">{event.errorMessage}</span>
              <span className="shrink-0 text-xs text-black/40 dark:text-white/40">
                {formatRelativeTime(event.timestamp)}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-black/50 dark:text-white/50">{label}</div>
      <div className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</div>
    </div>
  );
}
