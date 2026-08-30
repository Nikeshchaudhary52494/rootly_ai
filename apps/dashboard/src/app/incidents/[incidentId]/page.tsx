'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ErrorEventDetail, IncidentCodeContext, IncidentDetail, IncidentStatus } from '@incident-ai/shared';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

const STATUS_BADGE: Record<IncidentStatus, string> = {
  OPEN: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  RESOLVED: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  IGNORED: 'bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60',
};

const TABS = ['Overview', 'Events', 'Code Context'] as const;
type Tab = (typeof TABS)[number];

export default function IncidentDetailPage({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}) {
  const { incidentId } = use(params);
  const [tab, setTab] = useState<Tab>('Overview');
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

      <div className="flex gap-1 border-b border-black/10 dark:border-white/10">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t
                ? 'border-b-2 border-black text-black dark:border-white dark:text-white'
                : 'text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <OverviewTab incident={incident} />}
      {tab === 'Events' && <EventsTab incidentId={incidentId} />}
      {tab === 'Code Context' && <CodeContextTab incidentId={incidentId} />}
    </div>
  );
}

function OverviewTab({ incident }: { incident: IncidentDetail }) {
  return (
    <div className="flex flex-col gap-6">
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
    </div>
  );
}

function EventsTab({ incidentId }: { incidentId: string }) {
  const [events, setEvents] = useState<ErrorEventDetail[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listIncidentEvents(incidentId, { limit: 50 })
      .then((page) => {
        setEvents(page.data);
        setTotal(page.pagination.total);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load events'));
  }, [incidentId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!events) return <p className="text-sm text-black/50 dark:text-white/50">Loading...</p>;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-black/50 dark:text-white/50">{total} events</h2>
      <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
        {events.map((event) => (
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
  );
}

function CodeContextTab({ incidentId }: { incidentId: string }) {
  const [context, setContext] = useState<IncidentCodeContext | null | undefined>(undefined);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setContext(await api.getIncidentContext(incidentId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load code context');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  async function handleCollect() {
    setError(null);
    setCollecting(true);
    try {
      await api.collectIncidentContext(incidentId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to collect code context');
    } finally {
      setCollecting(false);
    }
  }

  if (context === undefined && !error) {
    return <p className="text-sm text-black/50 dark:text-white/50">Loading...</p>;
  }

  if (collecting) {
    return <p className="text-sm text-black/50 dark:text-white/50">Collecting repository context...</p>;
  }

  if (!context || context.status === 'FAILED') {
    const failureMessage = error ?? (context?.status === 'FAILED' ? context.summary ?? 'Code context collection failed.' : null);
    return (
      <div className="flex flex-col gap-3">
        {failureMessage && <p className="text-sm text-red-600">{failureMessage}</p>}
        <button
          onClick={handleCollect}
          className="self-start rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
        >
          Collect Code Context
        </button>
      </div>
    );
  }

  const primaryFile = context.files.find((f) => f.isPrimary);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-black/50 dark:text-white/50">{context.summary}</p>
        <button
          onClick={handleCollect}
          className="rounded-md border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          Re-collect
        </button>
      </div>

      {context.primaryLocation && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Primary Failure Location</h2>
          <p className="rounded-lg bg-black/5 p-3 font-mono text-sm dark:bg-white/10">
            {context.primaryLocation.filePath}
            {context.primaryLocation.lineNumber != null && `:${context.primaryLocation.lineNumber}`}
          </p>
        </div>
      )}

      {primaryFile && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Source Code</h2>
          <CodeWindow file={primaryFile} />
        </div>
      )}

      {context.relatedTests.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Related Tests</h2>
          <div className="flex flex-col gap-4">
            {context.relatedTests.map((test) => (
              <div key={test.filePath} className="flex flex-col gap-1">
                <p className="font-mono text-xs text-black/60 dark:text-white/60">{test.filePath}</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-3 font-mono text-xs leading-relaxed dark:bg-white/10">
                  {test.content}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {context.recentCommits.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Recent Git Commits</h2>
          <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
            {context.recentCommits.map((commit) => (
              <div key={commit.sha} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-black/50 dark:text-white/50">{commit.sha.slice(0, 7)}</span>
                  <span className="text-xs text-black/40 dark:text-white/40">
                    {formatRelativeTime(commit.committedAt)}
                  </span>
                </div>
                <p>{commit.message}</p>
                <p className="text-xs text-black/50 dark:text-white/50">{commit.authorName}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CodeWindow({ file }: { file: IncidentCodeContext['files'][number] }) {
  const lines = file.content.split('\n');
  return (
    <pre className="overflow-x-auto rounded-lg bg-black/5 p-3 font-mono text-xs leading-relaxed dark:bg-white/10">
      {lines.map((line, i) => {
        const lineNumber = file.contentStartLine + i;
        const isFailing = file.lineNumber != null && lineNumber === file.lineNumber;
        return (
          <div
            key={lineNumber}
            className={isFailing ? 'bg-red-200/60 dark:bg-red-900/40' : undefined}
          >
            <span className="mr-3 inline-block w-10 select-none text-right text-black/30 dark:text-white/30">
              {lineNumber}
            </span>
            {line}
            {isFailing && <span className="ml-2 text-red-600">← HIGHLIGHT</span>}
          </div>
        );
      })}
    </pre>
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
