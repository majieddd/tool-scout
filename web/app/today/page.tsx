import Link from "next/link";
import { GradeBadge } from "@/components/GradeBadge";
import { loadMeta, loadRecommendations } from "@/lib/data";

export const revalidate = 3600;

export default async function TodayPage() {
  const [recs, meta] = await Promise.all([loadRecommendations(), loadMeta()]);

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
      <header>
        <h1 className="font-mono text-2xl sm:text-3xl text-ink">Top picks today</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Computed from the {new Date(meta.generated_at).toLocaleDateString()}{" "}
          crawl, scored against the maintainer's profile and active projects.
        </p>
      </header>

      <ol className="mt-8 space-y-2">
        {recs.map((r) => (
          <li key={r.tool_id}>
            <Link
              href={`/tool/${r.tool_id}`}
              className="flex items-center gap-4 bg-bg-card border border-white/5 rounded-lg p-3 hover:border-accent/40 hover:bg-bg-subtle transition group"
            >
              <span className="font-mono text-sm text-ink-subtle w-8 tabular-nums">
                {r.rank.toString().padStart(2, " ")}
              </span>
              <GradeBadge letter={r.letter} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-sm text-ink truncate group-hover:text-accent transition">
                    {r.name}
                  </span>
                  <span className="text-xs text-ink-subtle shrink-0 font-mono tabular-nums">
                    {r.score.toFixed(2)}
                  </span>
                </div>
                <p className="text-xs text-ink-muted mt-0.5 truncate">
                  {r.category || "uncategorized"} · {r.reasoning}
                </p>
              </div>
            </Link>
          </li>
        ))}
        {recs.length === 0 && (
          <li className="text-ink-muted text-sm">
            No recommendations yet — wait for the next crawl.
          </li>
        )}
      </ol>
    </div>
  );
}
