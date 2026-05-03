import { notFound } from "next/navigation";
import Link from "next/link";
import { GradeBadge } from "@/components/GradeBadge";
import { GradeRadar } from "@/components/GradeRadar";
import { RequestButton } from "@/components/RequestButton";
import { loadToolById, loadTools } from "@/lib/data";

export const revalidate = 3600;

export async function generateStaticParams() {
  // Pre-render every tool's detail page at build time
  const tools = await loadTools();
  return tools.map((t) => ({ id: t.id }));
}

export default async function ToolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tool = await loadToolById(id);
  if (!tool) return notFound();
  const grade = tool.grade;

  return (
    <article className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← back to catalog
      </Link>

      <header className="mt-4 flex items-start gap-5">
        <GradeBadge letter={grade?.letter || "F"} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="font-mono text-xl sm:text-2xl text-ink break-words">
            {tool.name}
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            {tool.category || "uncategorized"}
            {tool.subcategory ? ` · ${tool.subcategory}` : ""}
            {" · "}
            <a
              href={tool.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              source ↗
            </a>
          </p>
        </div>
      </header>

      <section className="mt-8 grid sm:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h2 className="text-sm font-mono uppercase tracking-wide text-ink-subtle">
            About
          </h2>
          {tool.description && (
            <p className="text-ink leading-relaxed">{tool.description}</p>
          )}
          <dl className="text-sm space-y-1">
            <div className="flex gap-3">
              <dt className="w-28 text-ink-subtle">Source</dt>
              <dd className="text-ink-muted">{tool.source}</dd>
            </div>
            {tool.language && (
              <div className="flex gap-3">
                <dt className="w-28 text-ink-subtle">Language</dt>
                <dd className="text-ink-muted">{tool.language}</dd>
              </div>
            )}
            {tool.license && (
              <div className="flex gap-3">
                <dt className="w-28 text-ink-subtle">License</dt>
                <dd className="text-ink-muted">{tool.license}</dd>
              </div>
            )}
            {tool.stars > 0 && (
              <div className="flex gap-3">
                <dt className="w-28 text-ink-subtle">Stars</dt>
                <dd className="text-ink-muted">{tool.stars.toLocaleString()}</dd>
              </div>
            )}
            {tool.compatibility && (
              <div className="flex gap-3">
                <dt className="w-28 text-ink-subtle">Compatibility</dt>
                <dd className="text-ink-muted">{tool.compatibility}</dd>
              </div>
            )}
            {tool.last_updated && (
              <div className="flex gap-3">
                <dt className="w-28 text-ink-subtle">Updated</dt>
                <dd className="text-ink-muted">
                  {new Date(tool.last_updated).toLocaleDateString()}
                </dd>
              </div>
            )}
          </dl>
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-mono uppercase tracking-wide text-ink-subtle">
            Grade
          </h2>
          {grade ? (
            <>
              <GradeBadge letter={grade.letter} size="lg" showLabel />
              <p className="text-sm text-ink-muted">
                Total <span className="text-ink font-mono">{grade.total.toFixed(1)}</span> / 25
              </p>
              <div className="mt-3 bg-bg-card border border-white/5 rounded-lg p-3">
                <GradeRadar axes={grade.axes} />
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-muted">Not yet graded.</p>
          )}
        </div>
      </section>

      {tool.install_hint && (
        <section className="mt-8">
          <h2 className="text-sm font-mono uppercase tracking-wide text-ink-subtle mb-2">
            Install hint
          </h2>
          <pre className="bg-bg-card border border-white/10 rounded-lg p-3 overflow-x-auto text-xs text-ink font-mono">
            {tool.install_hint}
          </pre>
        </section>
      )}

      {tool.readme_excerpt && (
        <section className="mt-8">
          <h2 className="text-sm font-mono uppercase tracking-wide text-ink-subtle mb-2">
            From the README
          </h2>
          <p className="text-sm text-ink-muted whitespace-pre-wrap leading-relaxed">
            {tool.readme_excerpt}
          </p>
        </section>
      )}

      {(tool.tags || []).length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-mono uppercase tracking-wide text-ink-subtle mb-2">
            Tags
          </h2>
          <div className="flex flex-wrap gap-2">
            {tool.tags.map((t) => (
              <span
                key={t}
                className="px-2 py-1 rounded bg-bg-card border border-white/10 text-xs font-mono text-ink-muted"
              >
                #{t}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 border-t border-white/5 pt-8">
        <h2 className="text-sm font-mono uppercase tracking-wide text-ink-subtle mb-3">
          Don't see an MCP server for this?
        </h2>
        <p className="text-sm text-ink-muted mb-3">
          Request a Claude wrapper. Tool Scout will queue your request, generate
          a minimal MCP server in a sandboxed container on the maintainer's
          machine, smoke-test it, and publish the file here.
        </p>
        <RequestButton toolId={tool.id} toolName={tool.name} />
      </section>
    </article>
  );
}
