import Link from 'next/link';
import { api } from '@/lib/api';

export default async function ProjectsPage() {
  const projects = await api.listProjects().catch(() => []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Link
          href="/projects/new"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-black/80 dark:bg-white dark:text-black dark:hover:bg-white/80"
        >
          + New project
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">
          No projects yet. Create your first project to get started.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-black/10 rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="flex flex-col gap-1 px-4 py-3 hover:bg-black/5 dark:hover:bg-white/5"
            >
              <span className="font-medium">{project.name}</span>
              <span className="font-mono text-xs text-black/50 dark:text-white/50">
                {project.slug}
              </span>
              {project.description && (
                <span className="text-sm text-black/60 dark:text-white/60">
                  {project.description}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
