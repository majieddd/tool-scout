import Link from "next/link";
import { GradeBadge } from "@/components/GradeBadge";
import { loadTools } from "@/lib/data";
import { computeStack } from "@/lib/stack";

export const metadata = {
  title: "Recommended Base App Stack — Tool Scout",
  description:
    "A curated, layer-by-layer stack assembled from the highest-graded tools across the catalog. Stable picks per lane; only re-shuffled when a tool out-grades the current pick. Refreshed daily.",
};

export default async function StackPage() {
  const tools = await loadTools();
  const result = computeStack(tools);

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
      <header className="mb-8">
        <h1 className="font-mono text-2xl sm:text-3xl text-ink">
          Recommended Base App Stack
        </h1>
        <p className="text-sm text-ink-muted mt-3 max-w-2xl">
          A composable, layer-by-layer foundation for building Claude-native
          apps. Each layer pulls the highest-graded candidates from
          its lane in the catalog. Picks shift only when a tool out-grades
          the current selection — so the stack stays stable across refreshes
          while still tracking the frontier.
        </p>
        <p className="text-xs text-ink-subtle mt-2 font-mono">
          Composed from {result.totalCandidates.toLocaleString()} graded tools ·{" "}
          generated {new Date(result.generatedAt).toLocaleString()}
        </p>
      </header>

      <ol className="space-y-6">
        {result.layers.map((layer, i) => (
          <li
            key={layer.def.id}
            className="bg-bg-card border border-white/5 rounded-lg p-5"
          >
            <header className="mb-4 flex items-baseline gap-3">
              <span className="font-mono text-xs text-ink-subtle tabular-nums w-8 shrink-0 pt-0.5">
                {(i + 1).toString().padStart(2, "0")}
              </span>
              <div>
                <h2 className="font-mono text-base text-ink">{layer.def.name}</h2>
                <p className="text-xs text-ink-muted mt-1 max-w-2xl">
                  {layer.def.description}
                </p>
              </div>
            </header>

            {layer.primary.length === 0 ? (
              <p className="text-xs text-ink-subtle italic ml-11">
                No strong candidates in this lane right now.
              </p>
            ) : (
              <div className="ml-11 space-y-3">
                {layer.primary.map((p) => (
                  <Link
                    key={p.tool.id}
                    href={`/tool/${p.tool.id}/`}
                    className="flex items-start gap-3 bg-bg-subtle border border-white/5 rounded p-3 hover:border-accent/40 transition group"
                  >
                    <GradeBadge letter={p.tool.grade?.letter || "F"} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <h3 className="font-mono text-sm text-ink truncate group-hover:text-accent transition">
                          {p.tool.name}
                        </h3>
                        <span className="text-[11px] text-ink-subtle shrink-0 font-mono tabular-nums">
                          {p.reason}
                        </span>
                      </div>
                      {p.tool.description && (
                        <p className="text-xs text-ink-muted mt-0.5 line-clamp-1">
                          {p.tool.description}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}

                {layer.alternative.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-[11px] text-ink-subtle cursor-pointer hover:text-ink-muted transition list-none">
                      ▸ {layer.alternative.length} alternative{layer.alternative.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-2 space-y-1.5">
                      {layer.alternative.map((alt) => (
                        <li key={alt.tool.id}>
                          <Link
                            href={`/tool/${alt.tool.id}/`}
                            className="flex items-baseline gap-3 text-xs hover:text-ink transition"
                          >
                            <span className={`grade-${(alt.tool.grade?.letter || "f").toLowerCase()} font-mono w-3 shrink-0 text-center`}>
                              {alt.tool.grade?.letter}
                            </span>
                            <span className="font-mono text-ink-muted truncate">{alt.tool.name}</span>
                            <span className="text-ink-subtle truncate">{alt.tool.description}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      <p className="text-xs text-ink-subtle mt-8">
        How this is built: <Link href="/about/" className="text-accent hover:underline">read the algorithm</Link>.
        Each layer has a narrow filter (e.g., "filesystem MCP servers"); within the lane, picks are
        ranked by <code>grade.total + recency + log(stars) + Claude-compat boost</code>. Tools placed in one layer
        never reappear in another.
      </p>
    </div>
  );
}
