'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { ApiKeyMetadata, Environment, EnvironmentType, Project } from '@rootly.ai/shared';
import { api } from '@/lib/api';

const TABS = ['Overview', 'Environments', 'API Keys'] as const;
type Tab = (typeof TABS)[number];

const ENV_TYPES: EnvironmentType[] = ['DEVELOPMENT', 'STAGING', 'PRODUCTION'];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [tab, setTab] = useState<Tab>('Overview');
  const [project, setProject] = useState<Project | null>(null);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [apiKeys, setApiKeys] = useState<(ApiKeyMetadata & { environmentName: string })[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    try {
      const [proj, envs] = await Promise.all([
        api.getProject(projectId),
        api.listEnvironments(projectId),
      ]);
      setProject(proj);
      setEnvironments(envs);

      const keysByEnv = await Promise.all(
        envs.map(async (env) => {
          const keys = await api.listApiKeys(projectId, env.id);
          return keys.map((k) => ({ ...k, environmentName: env.name }));
        }),
      );
      setApiKeys(keysByEnv.flat());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project');
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!project) return <p className="text-sm text-black/50 dark:text-white/50">Loading...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="mt-1 font-mono text-sm text-black/50 dark:text-white/50">{project.slug}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/projects/${projectId}/incidents`}
            className="rounded-md border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            Incidents →
          </Link>
          <Link
            href={`/projects/${projectId}/events`}
            className="rounded-md border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            Error Events →
          </Link>
          <Link
            href={`/projects/${projectId}/repository`}
            className="rounded-md border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            Repository →
          </Link>
        </div>
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

      {tab === 'Overview' && (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className="text-black/50 dark:text-white/50">Description: </span>
            {project.description || '—'}
          </p>
          <p>
            <span className="text-black/50 dark:text-white/50">Environments: </span>
            {environments.length}
          </p>
          <p>
            <span className="text-black/50 dark:text-white/50">API keys: </span>
            {apiKeys.length}
          </p>
          <p>
            <span className="text-black/50 dark:text-white/50">Created: </span>
            {new Date(project.createdAt).toLocaleString()}
          </p>
        </div>
      )}

      {tab === 'Environments' && (
        <EnvironmentsTab
          projectId={projectId}
          environments={environments}
          onCreated={loadAll}
        />
      )}

      {tab === 'API Keys' && (
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
                  {key.keyPrefix}... · {key.environmentName}
                </div>
              </div>
              <span
                className={`text-xs ${key.revokedAt ? 'text-red-600' : 'text-green-600'}`}
              >
                {key.revokedAt ? 'Revoked' : 'Active'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EnvironmentsTab({
  projectId,
  environments,
  onCreated,
}: {
  projectId: string;
  environments: Environment[];
  onCreated: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [type, setType] = useState<EnvironmentType>('DEVELOPMENT');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.createEnvironment(projectId, { name, slug: slug || slugify(name), type });
      setShowForm(false);
      setName('');
      setSlug('');
      setSlugTouched(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create environment');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-black/50 dark:text-white/50">
          {environments.length} environment{environments.length === 1 ? '' : 's'}
        </h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          {showForm ? 'Cancel' : '+ Add environment'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
        >
          <div className="flex gap-3">
            <input
              required
              placeholder="Production"
              className="flex-1 rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
            <input
              required
              placeholder="production"
              pattern="[a-z0-9\-]+"
              className="flex-1 rounded-md border border-black/15 px-3 py-2 font-mono text-sm dark:border-white/15 dark:bg-transparent"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
            />
            <select
              className="rounded-md border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-transparent"
              value={type}
              onChange={(e) => setType(e.target.value as EnvironmentType)}
            >
              {ENV_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-white/80"
          >
            {submitting ? 'Creating...' : 'Create environment'}
          </button>
        </form>
      )}

      <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
        {environments.length === 0 && (
          <p className="px-4 py-3 text-sm text-black/50 dark:text-white/50">
            No environments yet.
          </p>
        )}
        {environments.map((env) => (
          <Link
            key={env.id}
            href={`/projects/${projectId}/environments/${env.id}`}
            className="flex items-center justify-between px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5"
          >
            <div>
              <div className="font-medium">{env.name}</div>
              <div className="font-mono text-xs text-black/50 dark:text-white/50">{env.slug}</div>
            </div>
            <span className="rounded-full border border-black/10 px-2 py-0.5 text-xs dark:border-white/10">
              {env.type}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
