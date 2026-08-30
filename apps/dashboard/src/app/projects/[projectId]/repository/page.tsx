'use client';

import { use, useEffect, useState } from 'react';
import type { Repository } from '@incident-ai/shared';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';

export default function ProjectRepositoryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [repository, setRepository] = useState<Repository | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setRepository(await api.getRepository(projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repository');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Repository</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {repository === undefined && !error && (
        <p className="text-sm text-black/50 dark:text-white/50">Loading...</p>
      )}
      {repository === null && <ConnectForm projectId={projectId} onConnected={load} />}
      {repository && <ConnectedRepository projectId={projectId} repository={repository} onChange={load} />}
    </div>
  );
}

function ConnectForm({ projectId, onConnected }: { projectId: string; onConnected: () => void }) {
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.connectRepository(projectId, { repositoryUrl, accessToken });
      setRepositoryUrl('');
      setAccessToken('');
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect repository');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex max-w-xl flex-col gap-4 rounded-lg border border-black/10 p-6 dark:border-white/10"
    >
      <div>
        <h2 className="text-lg font-medium">Connect GitHub Repository</h2>
        <p className="mt-1 text-sm text-black/50 dark:text-white/50">
          Connect one GitHub repository to fetch code context for incidents.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Repository URL
        <input
          required
          placeholder="https://github.com/owner/repository"
          className="rounded-md border border-black/15 px-3 py-2 font-mono text-sm dark:border-white/15 dark:bg-transparent"
          value={repositoryUrl}
          onChange={(e) => setRepositoryUrl(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        GitHub Access Token
        <input
          required
          type="password"
          placeholder="github_pat_..."
          className="rounded-md border border-black/15 px-3 py-2 font-mono text-sm dark:border-white/15 dark:bg-transparent"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/80"
      >
        {submitting ? 'Connecting...' : 'Connect Repository'}
      </button>
    </form>
  );
}

function ConnectedRepository({
  projectId,
  repository,
  onChange,
}: {
  projectId: string;
  repository: Repository;
  onChange: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncResult, setLastSyncResult] = useState<string | null>(null);

  async function handleSync() {
    setError(null);
    setSyncing(true);
    try {
      const result = await api.syncRepository(projectId);
      setLastSyncResult(`Synced ${result.fileCount} files.`);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync repository');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    setError(null);
    setDisconnecting(true);
    try {
      await api.disconnectRepository(projectId);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect repository');
      setDisconnecting(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4 rounded-lg border border-black/10 p-6 dark:border-white/10">
      <div>
        <h2 className="text-lg font-medium">GitHub Repository</h2>
        <p className="mt-1 font-mono text-sm text-black/70 dark:text-white/70">
          {repository.owner}/{repository.name}
        </p>
      </div>

      <div className="flex flex-col gap-1 text-sm text-black/50 dark:text-white/50">
        <span>Default Branch: {repository.defaultBranch}</span>
        <span>
          Last Sync: {repository.lastSyncedAt ? formatRelativeTime(repository.lastSyncedAt) : 'Never synced'}
        </span>
        {lastSyncResult && <span className="text-black/70 dark:text-white/70">{lastSyncResult}</span>}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="rounded-md border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/5"
        >
          {syncing ? 'Syncing...' : 'Sync Repository'}
        </button>
        <button
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950"
        >
          {disconnecting ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}
