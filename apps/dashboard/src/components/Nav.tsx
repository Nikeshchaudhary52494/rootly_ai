import Link from 'next/link';

export function Nav() {
  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
        <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
          rootly.ai
        </Link>
        <Link href="/projects" className="text-sm text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white">
          Projects
        </Link>
      </div>
    </header>
  );
}
