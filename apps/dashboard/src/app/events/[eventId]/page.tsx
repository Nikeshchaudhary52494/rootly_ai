'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ErrorEventDetail, Project } from '@incident-ai/shared';
import { api } from '@/lib/api';

export default function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const [event, setEvent] = useState<ErrorEventDetail | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .getEvent(eventId)
      .then(async (ev) => {
        setEvent(ev);
        setProject(await api.getProject(ev.projectId));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load event'));
  }, [eventId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!event) return <p className="text-sm text-black/50 dark:text-white/50">Loading...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        {project && (
          <Link
            href={`/projects/${project.id}/events`}
            className="text-sm text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
          >
            ← {project.name}
          </Link>
        )}
        <h1 className="mt-2 font-mono text-2xl font-semibold text-red-600">{event.errorName}</h1>
        <p className="mt-1 text-sm text-black/70 dark:text-white/70">{event.errorMessage}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-black/10 p-4 text-sm dark:border-white/10 sm:grid-cols-3">
        <Field label="Event ID" value={event.eventId} mono />
        <Field label="Service" value={event.serviceName} mono />
        <Field label="Environment" value={event.environmentName} mono />
        <Field label="Release" value={event.release ?? '—'} mono />
        <Field label="Occurred At" value={new Date(event.timestamp).toLocaleString()} />
        <Field label="Received At" value={new Date(event.receivedAt).toLocaleString()} />
      </div>

      <div className="text-sm">
        <span className="text-black/50 dark:text-white/50">Incident: </span>
        {event.incident ? (
          <Link
            href={`/incidents/${event.incident.id}`}
            className="font-mono underline hover:text-black dark:hover:text-white"
          >
            INC-{event.incident.sequenceNumber}
          </Link>
        ) : (
          <span className="font-mono text-black/50 dark:text-white/50">Unassigned</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Stack Trace</h2>
          {event.stackTrace && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(event.stackTrace ?? '');
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-md border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          )}
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-4 font-mono text-xs leading-relaxed dark:bg-white/10">
          {event.stackTrace || 'No stack trace available.'}
        </pre>
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
