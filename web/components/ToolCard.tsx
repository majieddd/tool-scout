import Link from "next/link";
import { GradeBadge } from "./GradeBadge";
import type { Tool } from "@/lib/data";

export function ToolCard({ tool }: { tool: Tool }) {
  const letter = tool.grade?.letter || "F";
  return (
    <Link
      href={`/tool/${tool.id}`}
      className="block group bg-bg-card border border-white/5 rounded-lg p-4 hover:border-accent/40 hover:bg-bg-subtle transition"
    >
      <div className="flex items-start gap-4">
        <GradeBadge letter={letter} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-mono text-sm text-ink truncate group-hover:text-accent transition">
              {tool.name}
            </h3>
            <span className="text-xs text-ink-subtle shrink-0">
              {tool.source}
            </span>
          </div>
          {tool.description && (
            <p className="text-sm text-ink-muted mt-1 line-clamp-2">
              {tool.description}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
            {tool.category && (
              <span className="px-2 py-0.5 rounded bg-white/5 text-ink-muted">
                {tool.category}
              </span>
            )}
            {tool.language && (
              <span className="px-2 py-0.5 rounded bg-white/5 text-ink-muted">
                {tool.language}
              </span>
            )}
            {tool.stars > 0 && (
              <span className="text-ink-subtle">★ {tool.stars.toLocaleString()}</span>
            )}
            {(tool.tags || []).slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-ink-subtle font-mono text-[11px]"
              >
                #{t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}
