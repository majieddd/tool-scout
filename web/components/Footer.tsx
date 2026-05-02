import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-white/5 mt-12 py-8">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between text-sm text-ink-muted">
        <div className="flex items-center gap-2">
          <span className="font-mono text-ink">tool-scout</span>
          <span className="text-ink-subtle">•</span>
          <span className="text-ink-subtle">a personal catalog by Majied</span>
        </div>
        <nav className="flex gap-4">
          <Link href="/terms" className="hover:text-ink transition">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-ink transition">
            Privacy
          </Link>
          <Link href="/policy" className="hover:text-ink transition">
            Policy
          </Link>
          <a
            href="https://github.com/majieddd/tool-scout/issues/new?labels=takedown&template=takedown.yml"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-ink transition"
          >
            Takedown
          </a>
        </nav>
      </div>
    </footer>
  );
}
