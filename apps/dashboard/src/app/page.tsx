import Link from 'next/link';
import { api } from '@/lib/api';

export default async function DashboardPage() {
  const projects = await api.listProjects().catch(() => []);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Incident AI</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          AI-powered incident response platform.
        </p>
      </div>

      <div className="flex gap-4">
        <div className="rounded-lg border border-black/10 px-4 py-3 dark:border-white/10">
          <div className="text-2xl font-semibold">{projects.length}</div>
          <div className="text-xs text-black/60 dark:text-white/60">Projects</div>
        </div>
      </div>

      <div className="flex gap-3">
        <Link
          href="/projects"
          className="rounded-md border border-black/10 px-4 py-2 text-sm font-medium hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
        >
          View projects
        </Link>
        <Link
          href="/projects/new"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
        >
          + New project
        </Link>
      </div>
    </div>
  );
}
