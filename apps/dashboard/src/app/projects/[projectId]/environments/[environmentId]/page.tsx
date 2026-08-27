'use client';

import { use, useEffect, useRef, useState } from 'react';
import type { ApiKeyMetadata, Environment } from '@incident-ai/shared';
import { api } from '@/lib/api';

export default function EnvironmentDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; environmentId: string }>;
}) {
  const { projectId, environmentId } = use(params);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyMetadata[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [keyName, setKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const createDialogRef = useRef<HTMLDialogElement>(null);

  async function load() {
    try {
      const [env, keys] = await Promise.all([
        api.getEnvironment(projectId, environmentId),
        api.listApiKeys(projectId, environmentId),
      ]);
      setEnvironment(env);
      setApiKeys(keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load environment');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, environmentId]);

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const created = await api.createApiKey(projectId, environmentId, keyName);
      createDialogRef.current?.close();
      setKeyName('');
      setRevealedKey(created.apiKey);
      setCopied(false);
      dialogRef.current?.showModal();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(apiKeyId: string) {
    await api.revokeApiKey(apiKeyId);
    await load();
  }

  function handleCopy() {
    if (!revealedKey) return;
    navigator.clipboard.writeText(revealedKey);
    setCopied(true);
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!environment) return <p className="text-sm text-black/50 dark:text-white/50">Loading...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Environment: {environment.name}</h1>
        <p className="mt-1 text-sm text-black/50 dark:text-white/50">{environment.type}</p>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-black/50 dark:text-white/50">API Keys</h2>
        <button
          onClick={() => createDialogRef.current?.showModal()}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
        >
          + Generate API Key
        </button>
      </div>

      <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
        {apiKeys.length === 0 && (
          <p className="px-4 py-3 text-sm text-black/50 dark:text-white/50">
            No API keys yet.
          </p>
        )}
        {apiKeys.map((key) => (
          <div key={key.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="text-sm font-medium">{key.name}</div>
              <div className="font-mono text-xs text-black/50 dark:text-white/50">
                Prefix: {key.keyPrefix}...
              </div>
              <div className="text-xs text-black/40 dark:text-white/40">
                Created: {new Date(key.createdAt).toLocaleString()}
                {key.lastUsedAt && ` · Last used: ${new Date(key.lastUsedAt).toLocaleString()}`}
              </div>
            </div>
            {key.revokedAt ? (
              <span className="text-xs text-red-600">Revoked</span>
            ) : (
              <button
                onClick={() => handleRevoke(key.id)}
                className="rounded-md border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Create key dialog */}
      <dialog
        ref={createDialogRef}
        className="w-full max-w-sm rounded-lg border border-black/10 p-6 backdrop:bg-black/40 dark:border-white/10 dark:bg-neutral-900"
      >
        <form onSubmit={handleCreateKey} className="flex flex-col gap-4">
          <h3 className="text-lg font-semibold">Generate API Key</h3>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Name</label>
            <input
              required
              autoFocus
              placeholder="Production SDK Key"
              className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => createDialogRef.current?.close()}
              className="rounded-md px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/80"
            >
              {creating ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </form>
      </dialog>

      {/* Reveal-once dialog */}
      <dialog
        ref={dialogRef}
        className="w-full max-w-lg rounded-lg border border-black/10 p-6 backdrop:bg-black/40 dark:border-white/10 dark:bg-neutral-900"
      >
        <div className="flex flex-col gap-4">
          <h3 className="text-lg font-semibold text-amber-600">IMPORTANT: API KEY</h3>
          <p className="text-sm text-black/60 dark:text-white/60">
            Copy this key now. You will not be able to view it again.
          </p>
          <code className="break-all rounded-md bg-black/5 p-3 text-sm dark:bg-white/10">
            {revealedKey}
          </code>
          <div className="flex justify-end gap-2">
            <button
              onClick={handleCopy}
              className="rounded-md border border-black/10 px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
            >
              {copied ? 'Copied!' : 'Copy Key'}
            </button>
            <button
              onClick={() => {
                dialogRef.current?.close();
                setRevealedKey(null);
              }}
              className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
            >
              Done
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
