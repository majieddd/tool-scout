"use client";

/**
 * DatabaseFilter — search/filter overlay for the Database table.
 *
 * Critical design choice: this component does NOT render rows. The 4400-row
 * `<table>` is rendered server-side in `page.tsx` and lives in the static
 * HTML. This component only attaches input listeners and toggles row
 * visibility via `element.style.display`. That means:
 *
 *   - AI crawlers / no-JS clients see every row in the initial response.
 *   - Filtering 4400 rows on every keystroke is a DOM op (sub-ms), not a
 *     React reconciliation (would be hundreds of ms and feel laggy).
 *   - The server stays authoritative; client filter is a UX overlay.
 *
 * The filter scopes to `#tool-database-table tbody [data-row="tool"]`.
 * Each row has `data-search` (lowercased searchable text), `data-grade`,
 * `data-category`, `data-language` so the filter can match without
 * touching innerText.
 */
import { useEffect, useRef, useState } from "react";

export function DatabaseFilter({
  totalRows,
  categories,
  languages,
  grades,
}: {
  totalRows: number;
  categories: string[];
  languages: string[];
  grades: string[];
}) {
  const [query, setQuery] = useState("");
  const [grade, setGrade] = useState("");
  const [category, setCategory] = useState("");
  const [language, setLanguage] = useState("");
  const [visibleCount, setVisibleCount] = useState(totalRows);
  const rafRef = useRef<number | null>(null);

  // Apply the filter on every input change. Debounced via requestAnimationFrame
  // so rapid typing doesn't queue thrashy DOM work.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const rows = document.querySelectorAll<HTMLTableRowElement>(
        '#tool-database-table tbody [data-row="tool"]',
      );
      const q = query.trim().toLowerCase();
      let shown = 0;
      rows.forEach((row) => {
        let match = true;
        if (grade && row.dataset.grade !== grade) match = false;
        if (match && category && row.dataset.category !== category) match = false;
        if (match && language && row.dataset.language !== language) match = false;
        if (match && q) {
          const hay = row.dataset.search || "";
          if (!hay.includes(q)) match = false;
        }
        // Use a class instead of inline display so it cooperates with
        // hover/striping styles; `hidden` is Tailwind's `display:none`.
        if (match) {
          row.classList.remove("hidden");
          shown++;
        } else {
          row.classList.add("hidden");
        }
      });
      setVisibleCount(shown);
      // Toggle the empty-state marker
      const empty = document.getElementById("database-empty-state");
      if (empty) {
        if (shown === 0) empty.classList.remove("hidden");
        else empty.classList.add("hidden");
      }
    });
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [query, grade, category, language]);

  const hasFilter = !!(query || grade || category || language);

  return (
    <section className="mb-4 bg-bg-card border border-white/5 rounded-lg p-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="search"
          placeholder="Filter by name, description, tag, language…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[200px] bg-bg border border-white/10 rounded px-3 py-1.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent/50"
          aria-label="Filter tools by text"
        />
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className="bg-bg border border-white/10 rounded px-2 py-1.5 text-sm text-ink-muted font-mono focus:outline-none focus:border-accent/50"
          aria-label="Filter by grade"
        >
          <option value="">All grades</option>
          {grades.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="bg-bg border border-white/10 rounded px-2 py-1.5 text-sm text-ink-muted font-mono focus:outline-none focus:border-accent/50"
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="bg-bg border border-white/10 rounded px-2 py-1.5 text-sm text-ink-muted font-mono focus:outline-none focus:border-accent/50"
          aria-label="Filter by language"
        >
          <option value="">All languages</option>
          {languages.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        {hasFilter && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setGrade("");
              setCategory("");
              setLanguage("");
            }}
            className="text-xs text-ink-subtle hover:text-ink font-mono px-2 py-1.5 rounded hover:bg-white/5 transition"
          >
            clear
          </button>
        )}
      </div>
      <p className="text-[11px] text-ink-subtle mt-2 font-mono">
        {hasFilter ? (
          <>
            showing {visibleCount.toLocaleString()} / {totalRows.toLocaleString()}{" "}
            rows
          </>
        ) : (
          <>
            showing all {totalRows.toLocaleString()} rows · filter is client-side,
            initial HTML always contains every row
          </>
        )}
      </p>
    </section>
  );
}
