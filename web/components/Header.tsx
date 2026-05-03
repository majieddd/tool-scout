import Link from "next/link";

export function Header() {
  return (
    <header className="border-b border-white/5 bg-bg/80 backdrop-blur-md sticky top-0 z-30">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 group">
          <span className="inline-block w-2 h-2 rounded-full bg-accent group-hover:scale-110 transition-transform" />
          <span className="font-mono text-base tracking-tight text-ink">
            tool-scout
          </span>
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm text-ink-muted">
          <Link
            href="/"
            className="px-3 py-1.5 rounded hover:text-ink hover:bg-white/5 transition"
          >
            Catalog
          </Link>
          <Link
            href="/today"
            className="px-3 py-1.5 rounded hover:text-ink hover:bg-white/5 transition"
          >
            Today
          </Link>
          <Link
            href="/analyze"
            className="px-3 py-1.5 rounded hover:text-ink hover:bg-white/5 transition"
          >
            Analyze
          </Link>
          <Link
            href="/about"
            className="px-3 py-1.5 rounded hover:text-ink hover:bg-white/5 transition"
          >
            About
          </Link>
          <a
            href="https://github.com/majieddd/tool-scout"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded hover:text-ink hover:bg-white/5 transition"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
