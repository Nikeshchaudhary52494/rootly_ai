'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  ErrorEventDetail,
  FixAttempt,
  FixAttemptDetail,
  IncidentCodeContext,
  IncidentDetail,
  IncidentStatus,
  InvestigationDetail,
  InvestigationSummary,
  PullRequest,
  ReproductionRun,
} from '@incident-ai/shared';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

const STATUS_BADGE: Record<IncidentStatus, string> = {
  OPEN: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  RESOLVED: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  IGNORED: 'bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60',
};

const TABS = ['Overview', 'Events', 'Code Context', 'AI Investigation', 'Reproduction', 'Fix', 'Pull Request'] as const;
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
      {tab === 'AI Investigation' && <InvestigationTab incidentId={incidentId} />}
      {tab === 'Reproduction' && <ReproductionTab incidentId={incidentId} />}
      {tab === 'Fix' && <FixTab incidentId={incidentId} />}
      {tab === 'Pull Request' && <PullRequestTab incidentId={incidentId} />}
    </div>
  );
}

interface TimelineStep {
  label: string;
  done: boolean;
}

function IncidentTimeline({ incidentId }: { incidentId: string }) {
  const [steps, setSteps] = useState<TimelineStep[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [context, investigations, reproductions, fixes, pullRequests] = await Promise.all([
        api.getIncidentContext(incidentId).catch(() => null),
        api.listIncidentInvestigations(incidentId).catch(() => []),
        api.listIncidentReproductionRuns(incidentId).catch(() => []),
        api.listIncidentFixAttempts(incidentId).catch(() => []),
        api.listIncidentPullRequests(incidentId).catch(() => []),
      ]);
      if (cancelled) return;

      setSteps([
        { label: 'Incident Created', done: true },
        { label: 'Code Context Collected', done: context?.status === 'READY' },
        { label: 'AI Investigation Completed', done: investigations.some((i) => i.status === 'COMPLETED') },
        { label: 'Bug Reproduced', done: reproductions.some((r) => r.result === 'REPRODUCED') },
        { label: 'Fix Generated', done: fixes.length > 0 },
        { label: 'Fix Verified', done: fixes.some((f) => f.result === 'FIX_VERIFIED') },
        { label: 'GitHub PR Created', done: pullRequests.some((p) => p.status === 'OPEN' || p.status === 'MERGED') },
      ]);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [incidentId]);

  if (!steps) return null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Timeline</h2>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-black/10 p-4 text-sm dark:border-white/10">
        {steps.map((step, i) => (
          <div key={step.label} className="flex items-center gap-2">
            <span className={`flex items-center gap-1.5 ${step.done ? 'text-black dark:text-white' : 'text-black/35 dark:text-white/35'}`}>
              <span className={step.done ? 'text-green-600 dark:text-green-400' : ''}>{step.done ? '✓' : '○'}</span>
              {step.label}
            </span>
            {i < steps.length - 1 && <span className="text-black/20 dark:text-white/20">→</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function OverviewTab({ incident }: { incident: IncidentDetail }) {
  return (
    <div className="flex flex-col gap-6">
      <IncidentTimeline incidentId={incident.id} />

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

const HYPOTHESIS_BADGE: Record<InvestigationDetail['hypotheses'][number]['status'], string> = {
  LIKELY: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  POSSIBLE: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  REJECTED: 'bg-black/10 text-black/50 dark:bg-white/10 dark:text-white/50',
};

function InvestigationTab({ incidentId }: { incidentId: string }) {
  const [history, setHistory] = useState<InvestigationSummary[] | null>(null);
  const [selected, setSelected] = useState<InvestigationDetail | null>(null);
  const [expandedHypothesisId, setExpandedHypothesisId] = useState<string | null>(null);
  const [investigating, setInvestigating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadHistory(selectId?: string) {
    try {
      const list = await api.listIncidentInvestigations(incidentId);
      setHistory(list);
      const targetId = selectId ?? list[0]?.id;
      if (targetId) {
        setSelected(await api.getInvestigation(targetId));
        setExpandedHypothesisId(null);
      } else {
        setSelected(null);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load investigations');
    }
  }

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  async function handleInvestigate() {
    setError(null);
    setInvestigating(true);
    try {
      const { investigationId } = await api.investigateIncident(incidentId);
      await loadHistory(investigationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start investigation');
    } finally {
      setInvestigating(false);
    }
  }

  if (history === null && !error) {
    return <p className="text-sm text-black/50 dark:text-white/50">Loading...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-black/50 dark:text-white/50">AI Investigation</h2>
        <button
          onClick={handleInvestigate}
          disabled={investigating}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/80"
        >
          {investigating ? 'Investigating...' : 'Investigate Incident'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {selected && (
        <InvestigationReport
          investigation={selected}
          expandedHypothesisId={expandedHypothesisId}
          onToggleHypothesis={(id) => setExpandedHypothesisId((current) => (current === id ? null : id))}
        />
      )}

      {!selected && !investigating && (
        <p className="text-sm text-black/50 dark:text-white/50">
          No investigation has been run for this incident yet.
        </p>
      )}

      {history && history.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Investigation History</h2>
          <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
            {history.map((run, i) => (
              <button
                key={run.id}
                onClick={() => api.getInvestigation(run.id).then((d) => { setSelected(d); setExpandedHypothesisId(null); })}
                className={`flex items-center justify-between px-4 py-3 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5 ${selected?.id === run.id ? 'bg-black/5 dark:bg-white/5' : ''}`}
              >
                <span>
                  Investigation #{history.length - i} · {run.status}
                  {run.finalConfidence != null && ` · Confidence: ${Math.round(run.finalConfidence * 100)}%`}
                </span>
                <span className="flex items-center gap-3 text-xs text-black/40 dark:text-white/40">
                  <span className="font-mono">{run.model}</span>
                  <span>{formatRelativeTime(run.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InvestigationReport({
  investigation,
  expandedHypothesisId,
  onToggleHypothesis,
}: {
  investigation: InvestigationDetail;
  expandedHypothesisId: string | null;
  onToggleHypothesis: (id: string) => void;
}) {
  if (investigation.status === 'FAILED') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        <p className="font-medium">Investigation failed.</p>
        {investigation.errorMessage && <p className="mt-1">{investigation.errorMessage}</p>}
      </div>
    );
  }

  if (investigation.status !== 'COMPLETED') {
    return <p className="text-sm text-black/50 dark:text-white/50">Investigating...</p>;
  }

  const topHypothesis = investigation.hypotheses[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
        <h3 className="text-xs font-medium uppercase tracking-wide text-black/50 dark:text-white/50">Root Cause</h3>
        <p className="mt-1 text-sm">{investigation.summary}</p>
        {investigation.finalConfidence != null && (
          <p className="mt-3 text-xs text-black/50 dark:text-white/50">
            Confidence: <span className="font-medium text-black dark:text-white">{Math.round(investigation.finalConfidence * 100)}%</span>
          </p>
        )}
      </div>

      {topHypothesis && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-black/50 dark:text-white/50">Evidence</h3>
          {/* Commit-based evidence has its own "Recent Changes" section below — don't show it twice. */}
          <EvidenceList
            evidence={investigation.evidence.filter((e) => e.hypothesisId === topHypothesis.id && e.sourceType !== 'GIT_COMMIT')}
          />
        </div>
      )}

      {topHypothesis && investigation.evidence.some((e) => e.hypothesisId === topHypothesis.id && e.sourceType === 'GIT_COMMIT') && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-black/50 dark:text-white/50">Recent Changes</h3>
          <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
            {investigation.evidence
              .filter((e) => e.hypothesisId === topHypothesis.id && e.sourceType === 'GIT_COMMIT')
              .map((e) => (
                <div key={e.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                  <span className="font-mono text-xs text-black/50 dark:text-white/50">{e.sourceReference.slice(0, 7)}</span>
                  <p>{e.description}</p>
                </div>
              ))}
          </div>
        </div>
      )}

      {investigation.recommendation && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-black/50 dark:text-white/50">Recommendation</h3>
          <p className="rounded-lg bg-black/5 p-4 text-sm dark:bg-white/10">{investigation.recommendation}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-black/50 dark:text-white/50">Possible Root Causes</h3>
        <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
          {investigation.hypotheses.map((h) => (
            <div key={h.id}>
              <button
                onClick={() => onToggleHypothesis(h.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span>
                  {h.rank}. {h.title}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-black/50 dark:text-white/50">{Math.round(h.confidence * 100)}%</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${HYPOTHESIS_BADGE[h.status]}`}>{h.status}</span>
                </span>
              </button>
              {expandedHypothesisId === h.id && (
                <div className="flex flex-col gap-3 px-4 pb-4 text-sm">
                  <p className="text-black/70 dark:text-white/70">{h.description}</p>
                  <EvidenceList evidence={investigation.evidence.filter((e) => e.hypothesisId === h.id)} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: InvestigationDetail['evidence'] }) {
  const supporting = evidence.filter((e) => e.type === 'SUPPORTING');
  const contradicting = evidence.filter((e) => e.type === 'CONTRADICTING');

  return (
    <div className="flex flex-col gap-2 text-sm">
      {supporting.map((e) => (
        <p key={e.id} className="flex items-start gap-2">
          <span className="text-green-600">✓</span>
          <span>
            {e.description}
            {e.sourceReference !== 'error' && (
              <span className="ml-1 font-mono text-xs text-black/50 dark:text-white/50">
                ({e.sourceReference}
                {e.lineStart != null ? `:${e.lineStart}` : ''})
              </span>
            )}
          </span>
        </p>
      ))}
      {contradicting.map((e) => (
        <p key={e.id} className="flex items-start gap-2">
          <span className="text-red-600">✗</span>
          <span>{e.description}</span>
        </p>
      ))}
      {supporting.length === 0 && contradicting.length === 0 && (
        <p className="text-black/50 dark:text-white/50">No evidence recorded.</p>
      )}
    </div>
  );
}

const REPRODUCTION_STAGE_LABEL: Record<string, string> = {
  PENDING: 'Preparing...',
  GENERATING_TEST: 'Generating reproduction test...',
  CREATING_SANDBOX: 'Creating sandbox...',
  CHECKING_OUT: 'Checking out repository...',
  INSTALLING: 'Installing dependencies...',
  RUNNING: 'Running test...',
  CLASSIFYING: 'Classifying result...',
};

const REPRODUCTION_RESULT_MESSAGE: Record<string, { label: string; className: string }> = {
  REPRODUCED: { label: '✓ Bug reproduced successfully', className: 'text-green-700 dark:text-green-400' },
  NOT_REPRODUCED: { label: 'Bug could not be reproduced', className: 'text-amber-700 dark:text-amber-400' },
  INCONCLUSIVE: { label: 'Reproduction was inconclusive', className: 'text-black/60 dark:text-white/60' },
};

const REPRODUCTION_POLL_INTERVAL_MS = 2000;

function ReproductionTab({ incidentId }: { incidentId: string }) {
  const [history, setHistory] = useState<ReproductionRun[] | null>(null);
  const [selected, setSelected] = useState<ReproductionRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  async function loadHistory(selectId?: string) {
    try {
      const list = await api.listIncidentReproductionRuns(incidentId);
      setHistory(list);
      const target = selectId ? list.find((r) => r.id === selectId) : list[0];
      if (target) setSelected(target);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reproduction runs');
    }
  }

  useEffect(() => {
    loadHistory();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  function startPolling(runId: string) {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      try {
        const run = await api.getReproductionRun(runId);
        setSelected(run);
        if (run.status === 'COMPLETED' || run.status === 'FAILED') {
          stopPolling();
          loadHistory(runId);
        }
      } catch {
        stopPolling();
      }
    }, REPRODUCTION_POLL_INTERVAL_MS);
  }

  async function handleReproduce() {
    setError(null);
    setStarting(true);
    try {
      const { id } = await api.reproduceIncident(incidentId);
      const run = await api.getReproductionRun(id);
      setSelected(run);
      startPolling(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start reproduction');
    } finally {
      setStarting(false);
    }
  }

  if (history === null && !error) {
    return <p className="text-sm text-black/50 dark:text-white/50">Loading...</p>;
  }

  const inProgress = Boolean(selected && selected.status !== 'COMPLETED' && selected.status !== 'FAILED');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Reproduction</h2>
        <button
          onClick={handleReproduce}
          disabled={starting || inProgress}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/80"
        >
          {starting || inProgress ? 'Reproducing...' : 'Reproduce Bug'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {selected && <ReproductionRunView run={selected} />}

      {!selected && !starting && (
        <p className="text-sm text-black/50 dark:text-white/50">
          No reproduction run has been started for this incident yet.
        </p>
      )}

      {history && history.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Reproduction History</h2>
          <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
            {history.map((run, i) => (
              <button
                key={run.id}
                onClick={() => {
                  stopPolling();
                  setSelected(run);
                }}
                className={`flex items-center justify-between px-4 py-3 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5 ${selected?.id === run.id ? 'bg-black/5 dark:bg-white/5' : ''}`}
              >
                <span>
                  Run #{history.length - i} · {run.status}
                  {run.result && ` · ${run.result}`}
                </span>
                <span className="flex items-center gap-3 text-xs text-black/40 dark:text-white/40">
                  {run.targetCommitSha && <span className="font-mono">{run.targetCommitSha.slice(0, 7)}</span>}
                  <span>{formatRelativeTime(run.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReproductionRunView({ run }: { run: ReproductionRun }) {
  if (run.status === 'FAILED') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        <p className="font-medium">Reproduction pipeline failed.</p>
        {run.errorMessage && <p className="mt-1">{run.errorMessage}</p>}
      </div>
    );
  }

  if (run.status !== 'COMPLETED') {
    return <p className="text-sm text-black/50 dark:text-white/50">{REPRODUCTION_STAGE_LABEL[run.status] ?? run.status}</p>;
  }

  const resultInfo = run.result ? REPRODUCTION_RESULT_MESSAGE[run.result] : null;

  return (
    <div className="flex flex-col gap-6">
      {resultInfo && (
        <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
          <p className={`text-sm font-medium ${resultInfo.className}`}>{resultInfo.label}</p>
          {run.result === 'INCONCLUSIVE' && run.errorMessage && (
            <p className="mt-1 text-xs text-black/50 dark:text-white/50">{run.errorMessage}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-black/10 p-4 text-sm dark:border-white/10 sm:grid-cols-3">
        <Field label="Result" value={run.result ?? 'Unknown'} />
        <Field label="Target Commit" value={run.targetCommitSha?.slice(0, 12) ?? '—'} mono />
        <Field label="Exit Code" value={run.exitCode != null ? String(run.exitCode) : '—'} mono />
        <Field label="Duration" value={run.durationMs != null ? `${(run.durationMs / 1000).toFixed(2)}s` : '—'} />
        <Field label="Created" value={new Date(run.createdAt).toLocaleString()} />
        <Field label="Completed" value={run.completedAt ? new Date(run.completedAt).toLocaleString() : '—'} />
      </div>

      {run.generatedTest && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-black/50 dark:text-white/50">Generated Test</h3>
          <p className="font-mono text-xs text-black/60 dark:text-white/60">{run.testFilePath}</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-4 font-mono text-xs leading-relaxed dark:bg-white/10">
            {run.generatedTest}
          </pre>
          {run.testExplanation && (
            <div className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
              <p className="text-xs font-medium uppercase tracking-wide text-black/40 dark:text-white/40">
                AI-generated reproduction hypothesis
              </p>
              <p className="mt-1 text-black/70 dark:text-white/70">{run.testExplanation}</p>
            </div>
          )}
        </div>
      )}

      {(run.stdout || run.stderr) && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-black/50 dark:text-white/50">Execution Output</h3>
          {run.stdout && (
            <div>
              <p className="text-xs text-black/50 dark:text-white/50">stdout</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-3 font-mono text-xs leading-relaxed dark:bg-white/10">
                {run.stdout}
              </pre>
            </div>
          )}
          {run.stderr && (
            <div>
              <p className="text-xs text-black/50 dark:text-white/50">stderr</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-3 font-mono text-xs leading-relaxed dark:bg-white/10">
                {run.stderr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const FIX_STAGE_LABEL: Record<string, string> = {
  PENDING: 'Preparing...',
  GENERATING_FIX: 'Generating fix proposal...',
  VALIDATING_PATCH: 'Validating patch...',
  CREATING_SANDBOX: 'Creating sandbox...',
  CHECKING_OUT: 'Checking out repository...',
  APPLYING_PATCH: 'Applying patch...',
  RUNNING_REPRODUCTION: 'Running reproduction test...',
  RUNNING_REGRESSION_TESTS: 'Running regression tests...',
  VALIDATING: 'Classifying result...',
};

const FIX_RESULT_MESSAGE: Record<string, { label: string; className: string }> = {
  FIX_VERIFIED: { label: '✓ Fix verified — reproduction resolved, no regressions', className: 'text-green-700 dark:text-green-400' },
  FIX_REJECTED: { label: '✗ Fix rejected', className: 'text-red-700 dark:text-red-400' },
  INCONCLUSIVE: { label: 'Fix validation was inconclusive', className: 'text-black/60 dark:text-white/60' },
};

const FIX_POLL_INTERVAL_MS = 2000;

function FixTab({ incidentId }: { incidentId: string }) {
  const [history, setHistory] = useState<FixAttempt[] | null>(null);
  const [selected, setSelected] = useState<FixAttemptDetail | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  async function loadHistory(selectId?: string) {
    try {
      const list = await api.listIncidentFixAttempts(incidentId);
      setHistory(list);
      const targetId = selectId ?? list[0]?.id;
      if (targetId) setSelected(await api.getFixAttempt(targetId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fix attempts');
    }
  }

  useEffect(() => {
    loadHistory();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  function startPolling(fixAttemptId: string) {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      try {
        const attempt = await api.getFixAttempt(fixAttemptId);
        setSelected(attempt);
        if (attempt.status === 'COMPLETED' || attempt.status === 'FAILED') {
          stopPolling();
          loadHistory(fixAttemptId);
        }
      } catch {
        stopPolling();
      }
    }, FIX_POLL_INTERVAL_MS);
  }

  async function handleGenerateFix() {
    setError(null);
    setStarting(true);
    try {
      const { id } = await api.startFix(incidentId);
      setSelected(await api.getFixAttempt(id));
      startPolling(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start fix generation');
    } finally {
      setStarting(false);
    }
  }

  if (history === null && !error) {
    return <p className="text-sm text-black/50 dark:text-white/50">Loading...</p>;
  }

  const inProgress = Boolean(selected && selected.status !== 'COMPLETED' && selected.status !== 'FAILED');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-black/50 dark:text-white/50">AI Fix</h2>
        <button
          onClick={handleGenerateFix}
          disabled={starting || inProgress}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/80"
        >
          {starting || inProgress ? 'Generating fix...' : 'Generate Fix'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {selected && <FixAttemptView attempt={selected} />}

      {!selected && !starting && (
        <p className="text-sm text-black/50 dark:text-white/50">
          No fix has been generated for this incident yet. A confirmed reproduction (Reproduction tab) is required first.
        </p>
      )}

      {history && history.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Fix History</h2>
          <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
            {history.map((attempt, i) => (
              <button
                key={attempt.id}
                onClick={() => {
                  stopPolling();
                  api.getFixAttempt(attempt.id).then(setSelected);
                }}
                className={`flex items-center justify-between px-4 py-3 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5 ${selected?.id === attempt.id ? 'bg-black/5 dark:bg-white/5' : ''}`}
              >
                <span>
                  Attempt #{history.length - i} · {attempt.status}
                  {attempt.result && ` · ${attempt.result}`}
                </span>
                <span className="flex items-center gap-3 text-xs text-black/40 dark:text-white/40">
                  {attempt.targetCommitSha && <span className="font-mono">{attempt.targetCommitSha.slice(0, 7)}</span>}
                  <span>{formatRelativeTime(attempt.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CheckRow({ label, status, reason }: { label: string; status: 'pass' | 'fail' | 'skip'; reason?: string | null }) {
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '—';
  const className =
    status === 'pass'
      ? 'text-green-600 dark:text-green-400'
      : status === 'fail'
        ? 'text-red-600 dark:text-red-400'
        : 'text-black/40 dark:text-white/40';
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className={className}>{icon}</span>
      <span>
        {label}
        {reason && <span className="ml-1 text-xs text-black/50 dark:text-white/50">({reason})</span>}
      </span>
    </div>
  );
}

function FixAttemptView({ attempt }: { attempt: FixAttemptDetail }) {
  if (attempt.status === 'FAILED') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        <p className="font-medium">Fix pipeline failed.</p>
        {attempt.errorMessage && <p className="mt-1">{attempt.errorMessage}</p>}
      </div>
    );
  }

  if (attempt.status !== 'COMPLETED') {
    return <p className="text-sm text-black/50 dark:text-white/50">{FIX_STAGE_LABEL[attempt.status] ?? attempt.status}</p>;
  }

  const resultInfo = attempt.result ? FIX_RESULT_MESSAGE[attempt.result] : null;
  const summary = attempt.validationSummary;

  return (
    <div className="flex flex-col gap-6">
      {resultInfo && (
        <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
          <p className={`text-sm font-medium ${resultInfo.className}`}>{resultInfo.label}</p>
          {attempt.result !== 'FIX_VERIFIED' && attempt.errorMessage && (
            <p className="mt-1 text-xs text-black/50 dark:text-white/50">{attempt.errorMessage}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-black/10 p-4 text-sm dark:border-white/10 sm:grid-cols-3">
        <Field label="Result" value={attempt.result ?? 'Unknown'} />
        <Field label="Target Commit" value={attempt.targetCommitSha?.slice(0, 12) ?? '—'} mono />
        <Field label="Files Changed" value={String(attempt.changedFiles.length)} />
        <Field label="Created" value={new Date(attempt.createdAt).toLocaleString()} />
        <Field label="Completed" value={attempt.completedAt ? new Date(attempt.completedAt).toLocaleString() : '—'} />
      </div>

      {attempt.explanation && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-black/50 dark:text-white/50">AI Explanation</h3>
          <p className="rounded-lg bg-black/5 p-4 text-sm dark:bg-white/10">{attempt.explanation}</p>
        </div>
      )}

      {summary && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-black/50 dark:text-white/50">Validation Steps</h3>
          <div className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 dark:border-white/10">
            <CheckRow label="Patch applied to a fresh sandbox checkout" status={summary.patchApplied ? 'pass' : 'fail'} />
            <CheckRow
              label="Before-fix reproduction confirmed the bug"
              status={summary.reproductionBeforeFix.result === 'REPRODUCED' ? 'pass' : 'fail'}
              reason={summary.reproductionBeforeFix.result}
            />
            <CheckRow
              label="Post-fix validation: bug no longer occurs"
              status={summary.postFixValidation.outcome === 'PASSED' ? 'pass' : summary.postFixValidation.outcome ? 'fail' : 'skip'}
              reason={summary.postFixValidation.outcome}
            />
            <CheckRow
              label={`Regression tests${summary.regressionTests.total ? ` (${summary.regressionTests.total} run, ${summary.regressionTests.failed} failed)` : ''}`}
              status={
                summary.regressionTests.outcome === 'PASSED' || summary.regressionTests.outcome === 'SKIPPED'
                  ? 'pass'
                  : summary.regressionTests.outcome
                    ? 'fail'
                    : 'skip'
              }
              reason={summary.regressionTests.outcome === 'SKIPPED' ? 'no related tests found' : null}
            />
          </div>
        </div>
      )}

      {attempt.patches.length > 0 && (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-medium text-black/50 dark:text-white/50">Patch</h3>
          {attempt.patches.map((patch) => (
            <div key={patch.filePath} className="flex flex-col gap-1">
              <p className="font-mono text-xs text-black/60 dark:text-white/60">{patch.filePath}</p>
              <DiffView diff={patch.diff} />
            </div>
          ))}
        </div>
      )}

      {(attempt.stdout || attempt.stderr) && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-black/50 dark:text-white/50">Execution Output</h3>
          {attempt.stdout && (
            <div>
              <p className="text-xs text-black/50 dark:text-white/50">stdout</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-3 font-mono text-xs leading-relaxed dark:bg-white/10">
                {attempt.stdout}
              </pre>
            </div>
          )}
          {attempt.stderr && (
            <div>
              <p className="text-xs text-black/50 dark:text-white/50">stderr</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-3 font-mono text-xs leading-relaxed dark:bg-white/10">
                {attempt.stderr}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n');
  return (
    <pre className="overflow-x-auto whitespace-pre rounded-lg bg-black/5 p-3 font-mono text-xs leading-relaxed dark:bg-white/10">
      {lines.map((line, i) => {
        const className = line.startsWith('+')
          ? 'text-green-700 dark:text-green-400'
          : line.startsWith('-')
            ? 'text-red-700 dark:text-red-400'
            : line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')
              ? 'text-black/40 dark:text-white/40'
              : undefined;
        return (
          <div key={i} className={className}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

const PR_STATUS_BADGE: Record<PullRequest['status'], string> = {
  CREATING: 'bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60',
  OPEN: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  CLOSED: 'bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60',
  MERGED: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

const PR_POLL_INTERVAL_MS = 2000;

function PullRequestTab({ incidentId }: { incidentId: string }) {
  const [history, setHistory] = useState<PullRequest[] | null>(null);
  const [selected, setSelected] = useState<PullRequest | null>(null);
  const [latestFixVerified, setLatestFixVerified] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  async function loadHistory(selectId?: string) {
    try {
      const list = await api.listIncidentPullRequests(incidentId);
      setHistory(list);
      const target = selectId ? list.find((p) => p.id === selectId) : list[0];
      if (target) setSelected(target);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pull requests');
    }
  }

  async function loadFixStatus() {
    try {
      const fixes = await api.listIncidentFixAttempts(incidentId);
      setLatestFixVerified(fixes[0]?.result === 'FIX_VERIFIED');
    } catch {
      setLatestFixVerified(false);
    }
  }

  useEffect(() => {
    loadHistory();
    loadFixStatus();
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  function startPolling(pullRequestId: string) {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      try {
        const pr = await api.getPullRequest(pullRequestId);
        setSelected(pr);
        if (pr.status !== 'CREATING') {
          stopPolling();
          loadHistory(pullRequestId);
        }
      } catch {
        stopPolling();
      }
    }, PR_POLL_INTERVAL_MS);
  }

  async function handleCreatePr() {
    setError(null);
    setCreating(true);
    try {
      const { id } = await api.createPr(incidentId);
      setSelected(await api.getPullRequest(id));
      startPolling(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pull request');
    } finally {
      setCreating(false);
    }
  }

  if (history === null || latestFixVerified === null) {
    return <p className="text-sm text-black/50 dark:text-white/50">Loading...</p>;
  }

  const inProgress = Boolean(selected && selected.status === 'CREATING');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-black/50 dark:text-white/50">GitHub Pull Request</h2>
        <button
          onClick={handleCreatePr}
          disabled={creating || inProgress || !latestFixVerified}
          title={!latestFixVerified ? 'A verified fix is required before creating a pull request.' : undefined}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/80"
        >
          {creating || inProgress ? 'Creating PR...' : 'Create GitHub PR'}
        </button>
      </div>

      {!latestFixVerified && (
        <p className="text-sm text-black/50 dark:text-white/50">
          A verified fix (Fix tab) is required before a pull request can be created.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {selected && <PullRequestView pr={selected} />}

      {!selected && !creating && latestFixVerified && (
        <p className="text-sm text-black/50 dark:text-white/50">No pull request has been created for this incident yet.</p>
      )}

      {history.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-black/50 dark:text-white/50">Pull Request History</h2>
          <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
            {history.map((pr, i) => (
              <button
                key={pr.id}
                onClick={() => {
                  stopPolling();
                  setSelected(pr);
                }}
                className={`flex items-center justify-between px-4 py-3 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5 ${selected?.id === pr.id ? 'bg-black/5 dark:bg-white/5' : ''}`}
              >
                <span className="flex items-center gap-2">
                  PR {history.length - i}
                  {pr.prNumber != null && ` · #${pr.prNumber}`}
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PR_STATUS_BADGE[pr.status]}`}>{pr.status}</span>
                </span>
                <span className="flex items-center gap-3 text-xs text-black/40 dark:text-white/40">
                  <span className="font-mono">{pr.branchName}</span>
                  <span>{formatRelativeTime(pr.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PullRequestView({ pr }: { pr: PullRequest }) {
  if (pr.status === 'FAILED') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
        <p className="font-medium">Pull request creation failed.</p>
        {pr.errorMessage && <p className="mt-1">{pr.errorMessage}</p>}
      </div>
    );
  }

  if (pr.status === 'CREATING') {
    return <p className="text-sm text-black/50 dark:text-white/50">Creating pull request...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
        <p className="text-sm font-medium text-green-700 dark:text-green-400">✓ Pull Request Created</p>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-black/10 p-4 text-sm dark:border-white/10 sm:grid-cols-3">
        <Field label="PR" value={pr.prNumber != null ? `#${pr.prNumber}` : '—'} />
        <Field label="Status" value={pr.status} />
        <Field label="Branch" value={pr.branchName} mono />
        <Field label="Base Branch" value={pr.baseBranch} mono />
        <Field label="Commit" value={pr.commitSha?.slice(0, 12) ?? '—'} mono />
        <Field label="Created" value={new Date(pr.createdAt).toLocaleString()} />
      </div>

      {pr.prUrl && (
        <a
          href={pr.prUrl}
          target="_blank"
          rel="noreferrer"
          className="self-start rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
        >
          Open Pull Request
        </a>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-black/50 dark:text-white/50">Title</h3>
        <p className="rounded-lg bg-black/5 p-3 text-sm dark:bg-white/10">{pr.title}</p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-black/50 dark:text-white/50">Description</h3>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/5 p-4 font-mono text-xs leading-relaxed dark:bg-white/10">
          {pr.body}
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
