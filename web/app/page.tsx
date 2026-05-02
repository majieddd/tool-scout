import Link from "next/link";
import { ToolCard } from "@/components/ToolCard";
import { CatalogClient } from "./CatalogClient";
import { loadMeta, loadTools } from "@/lib/data";

export const revalidate = 3600;  // ISR — refresh hourly

export default async function HomePage() {
  const [tools, meta] = await Promise.all([loadTools(), loadMeta()]);

  // Sort by total grade desc as default
  tools.sort((a, b) => (b.grade?.total ?? 0) - (a.grade?.total ?? 0));

  // Distinct categories + sources for filter dropdowns
  const categories = Array.from(
    new Set(tools.map((t) => t.category).filter(Boolean) as string[])
  ).sort();
  const sources = Array.from(new Set(tools.map((t) => t.source))).sort();

  return (
    <div>
      <section className="hero-grid border-b border-white/5">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12 sm:py-20">
          <h1 className="text-3xl sm:text-5xl font-mono tracking-tight text-ink">
            Tool Scout
          </h1>
          <p className="mt-3 text-ink-muted max-w-2xl text-base sm:text-lg">
            A daily-crawled catalog of MCP servers, Claude Code plugins,
            skills, and useful CLIs. Letter-graded against a personal profile.
            Request a Claude wrapper for any tool and get a downloadable MCP
            server back.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-muted">
            <span>
              <span className="text-ink font-medium">{meta.live_tools.toLocaleString()}</span>{" "}
              tools indexed
            </span>
            {meta.last_crawl?.ended_at && (
              <span>
                last crawl{" "}
                <span className="text-ink font-medium">
                  {new Date(meta.last_crawl.ended_at).toLocaleString()}
                </span>
              </span>
            )}
            <Link
              href="/today"
              className="text-accent hover:underline underline-offset-2"
            >
              Top picks today →
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <CatalogClient tools={tools} categories={categories} sources={sources} />
      </section>
    </div>
  );
}
