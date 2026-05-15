/**
 * Database page — AI-crawl-optimized full table of every tool in the catalog.
 *
 * Design intent:
 *   - **Every row is in the initial server-rendered HTML.** No pagination,
 *     no JS-gated content, no virtualization. An AI agent that fetches this
 *     page gets the entire catalog in one HTTP response.
 *   - **Semantic table markup** (caption + thead + tbody + scoped headers)
 *     so screen readers, RSS-like parsers, and LLMs can all read it.
 *   - **Per-row machine fields** as `data-*` attributes (`data-tool-id`,
 *     `data-grade`, `data-language`, etc.) so a crawler can grep without
 *     having to parse cell text.
 *   - **Machine-readable companion** — the raw JSON is reachable at
 *     `/data/tools.json`. Linked prominently at the top of the page so an
 *     agent reading the HTML knows it can fetch the JSON instead.
 *   - **Filter is a tiny client overlay** ([DatabaseFilter]) that hides
 *     rows via DOM, never re-renders React with 4400 rows. The default
 *     state on first paint = every row visible.
 *
 * This page is large (multi-megabyte HTML) on purpose. The whole point is
 * to let an AI grab everything in one shot.
 */
import Link from "next/link";
import { loadTools, loadMeta, type Tool } from "@/lib/data";
import { DatabaseFilter } from "./DatabaseFilter";

export const metadata = {
  title: "Database — Tool Scout",
  description:
    "Full table of every Claude-compatible tool in the Tool Scout catalog — MCP servers, plugins, skills, CLIs. Designed for AI agents and crawlers: every row in the initial HTML, all fields visible, no JS required.",
  // Be aggressive about indexability — we WANT crawlers eating this page
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
    },
  },
};

// Truncate description for table cells — full text still readable in the
// linked detail page, but the table itself stays scannable for crawlers
// and keeps the HTML under a few megabytes.
const DESC_TRUNCATE = 240;

// Explicit grade→class map. Tailwind's JIT scans source for literal class
// strings; `bg-grade-${letter}` template interpolation gets purged. Mirrors
// the pattern used in components/GradeBadge.tsx.
const GRADE_BG: Record<string, string> = {
  S: "bg-grade-s",
  A: "bg-grade-a",
  B: "bg-grade-b",
  C: "bg-grade-c",
  D: "bg-grade-d",
  F: "bg-grade-f",
};

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

// Build the per-row searchable haystack — used by both the visible cells
// and the client-side filter. Kept in sync with what we want crawlers to
// match against.
function rowSearchText(t: Tool): string {
  return [
    t.name || "",
    t.description || "",
    t.category || "",
    t.subcategory || "",
    t.language || "",
    (t.tags || []).join(" "),
    t.compatibility || "",
  ]
    .join(" ")
    .toLowerCase();
}

export default async function DatabasePage() {
  const [tools, meta] = await Promise.all([loadTools(), loadMeta()]);

  // Sort by grade total desc (best tools first), then by stars desc as tiebreak.
  // Keeps the most relevant tools at the top of the table for both humans
  // skimming and AI agents that truncate at some scroll depth.
  const sorted = [...tools].sort((a, b) => {
    const ga = a.grade?.total ?? -1;
    const gb = b.grade?.total ?? -1;
    if (gb !== ga) return gb - ga;
    return (b.stars || 0) - (a.stars || 0);
  });

  // Distinct values for the filter dropdowns — keeps the chooser sane
  // even at 4400 tools.
  const distinctCategories = Array.from(
    new Set(sorted.map((t) => t.category).filter(Boolean) as string[]),
  ).sort();
  const distinctLanguages = Array.from(
    new Set(sorted.map((t) => t.language).filter(Boolean) as string[]),
  ).sort();
  const distinctGrades = Array.from(
    new Set(sorted.map((t) => t.grade?.letter).filter(Boolean) as string[]),
  ).sort();

  return (
    <div className="mx-auto max-w-[1400px] px-4 sm:px-6 py-8">
      <header className="mb-6">
        <h1 className="font-mono text-2xl sm:text-3xl text-ink">Database</h1>
        <p className="text-sm text-ink-muted mt-3 max-w-3xl">
          Full table of every tool in the catalog —{" "}
          <span className="text-ink font-medium">
            {sorted.length.toLocaleString()}
          </span>{" "}
          rows, all in the initial HTML, no pagination, no JS required to read.
          Built for AI agents and crawlers; humans can use the filter below.
        </p>
        {meta.last_crawl?.ended_at && (
          <p className="text-xs text-ink-subtle mt-1.5 font-mono">
            last crawl: {new Date(meta.last_crawl.ended_at).toISOString()}
          </p>
        )}

        {/* Machine-readable hint — surface the raw JSON path prominently so
            an AI reading this HTML knows it can grab the entire catalog as
            one structured fetch instead of scraping the table. */}
        <div className="mt-4 rounded-lg border border-white/5 bg-bg-card p-3 text-xs">
          <p className="font-mono uppercase text-ink-subtle mb-1.5">
            For machine consumption
          </p>
          <ul className="space-y-1 text-ink-muted">
            <li>
              Raw JSON (single fetch, structured):{" "}
              <Link
                href="/data/tools.json"
                className="font-mono text-accent hover:underline underline-offset-2"
              >
                /data/tools.json
              </Link>
            </li>
            <li>
              Per-tool detail page URL pattern:{" "}
              <code className="font-mono text-ink">
                /tool/&lt;id&gt;/
              </code>
            </li>
            <li>
              Sitemap (all routes incl. per-tool pages):{" "}
              <Link
                href="/sitemap.xml"
                className="font-mono text-accent hover:underline underline-offset-2"
              >
                /sitemap.xml
              </Link>
            </li>
            <li>
              Sort: rows are pre-sorted by grade total desc, then stars desc.
              Column headers describe the schema.
            </li>
          </ul>
        </div>
      </header>

      <DatabaseFilter
        totalRows={sorted.length}
        categories={distinctCategories}
        languages={distinctLanguages}
        grades={distinctGrades}
      />

      {/* The table — every row in the initial HTML. Wide table is allowed to
          scroll horizontally on narrow screens; on desktop it fits. */}
      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table
          id="tool-database-table"
          className="w-full text-xs border-collapse"
        >
          <caption className="sr-only">
            Tool Scout catalog — {sorted.length} graded Claude-compatible tools
            (MCP servers, plugins, skills, CLIs). Sorted by grade desc, then
            stars desc.
          </caption>
          <thead className="sticky top-[57px] z-10 bg-bg/95 backdrop-blur-sm">
            <tr className="border-b border-white/10 text-left">
              <th
                scope="col"
                className="px-2 py-2 font-mono text-[10px] uppercase text-ink-subtle tracking-wider w-10"
              >
                #
              </th>
              <th
                scope="col"
                className="px-2 py-2 font-mono text-[10px] uppercase text-ink-subtle tracking-wider w-12"
              >
                Grade
              </th>
              <th
                scope="col"
                className="px-2 py-2 font-mono text-[10px] uppercase text-ink-subtle tracking-wider"
              >
                Name
              </th>
              <th
                scope="col"
                className="px-2 py-2 font-mono text-[10px] uppercase text-ink-subtle tracking-wider w-24"
              >
                Category
              </th>
              <th
                scope="col"
                className="px-2 py-2 font-mono text-[10px] uppercase text-ink-subtle tracking-wider w-24"
              >
                Subcategory
              </th>
              <th
                scope="col"
                className="px-2 py-2 font-mono text-[10px] uppercase text-ink-subtle tracking-wider w-20"
              >
                Language
              </th>
              <th
                scope="col"
                className="px-2 py-2 font-mono text-[10px] uppercase text-ink-subtle tracking-wider w-24"
              >
                Compatibility
              </th>
              <th
                scope="col"
                className="px-2 py-2 font-mono text-[10px] uppercase text-ink-subtle tracking-wider w-16 text-right"
              >
                ★
              </th>
              <th
                scope="col"
                className="px-2 py-2 font-mono text-[10px] uppercase text-ink-subtle tracking-wider"
              >
                Description
              </th>
              <th
                scope="col"
                className="px-2 py-2 font-mono text-[10px] uppercase text-ink-subtle tracking-wider"
              >
                Tags
              </th>
              <th
                scope="col"
                className="px-2 py-2 font-mono text-[10px] uppercase text-ink-subtle tracking-wider w-16"
              >
                Detail
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => {
              const letter = (t.grade?.letter || "F").toUpperCase();
              const tagsJoined = (t.tags || []).join(", ");
              const search = rowSearchText(t);
              return (
                <tr
                  key={t.id}
                  data-row="tool"
                  data-tool-id={t.id}
                  data-grade={letter}
                  data-category={t.category || ""}
                  data-language={t.language || ""}
                  data-compatibility={t.compatibility || ""}
                  data-search={search}
                  className="border-b border-white/5 hover:bg-white/5 align-top"
                >
                  <td className="px-2 py-1.5 font-mono text-ink-subtle tabular-nums">
                    {i + 1}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded font-mono font-bold text-bg text-[11px] ${GRADE_BG[letter] || GRADE_BG.F}`}
                    >
                      {letter}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/tool/${t.id}/`}
                      className="font-mono text-ink hover:text-accent transition break-all"
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-ink-muted font-mono">
                    {t.category || "—"}
                  </td>
                  <td className="px-2 py-1.5 text-ink-muted font-mono">
                    {t.subcategory || "—"}
                  </td>
                  <td className="px-2 py-1.5 text-ink-muted font-mono">
                    {t.language || "—"}
                  </td>
                  <td className="px-2 py-1.5 text-ink-muted font-mono">
                    {t.compatibility || "—"}
                  </td>
                  <td className="px-2 py-1.5 text-ink-muted font-mono text-right tabular-nums">
                    {(t.stars || 0).toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 text-ink-muted max-w-md">
                    {truncate(t.description, DESC_TRUNCATE) || "—"}
                  </td>
                  <td className="px-2 py-1.5 text-ink-subtle font-mono max-w-xs break-words">
                    {tagsJoined || "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/tool/${t.id}/`}
                      className="text-accent hover:underline underline-offset-2"
                    >
                      view →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Empty-state marker — only shown when client filter hides everything.
          Server-rendered as hidden; the filter toggles it. */}
      <p
        id="database-empty-state"
        className="hidden text-sm text-ink-muted text-center py-12"
      >
        No tools match the current filter. Clear it to see all{" "}
        {sorted.length.toLocaleString()} rows.
      </p>

      <footer className="mt-8 pt-6 border-t border-white/5 text-xs text-ink-subtle">
        <p>
          Table shows {sorted.length.toLocaleString()} tools. For full
          per-tool data (readme excerpts, install hints, grade axes, etc.) use
          the detail link in each row or fetch{" "}
          <Link
            href="/data/tools.json"
            className="text-accent hover:underline underline-offset-2"
          >
            /data/tools.json
          </Link>
          .
        </p>
      </footer>
    </div>
  );
}
