"use client";

import { useState } from "react";

export type Filters = {
  query: string;
  letter: string;        // "" | "S" | "A" | ...
  category: string;      // "" | "mcp_server" | ...
  source: string;        // "" | "github" | ...
};

export function FilterBar({
  initial,
  onChange,
  categories,
  sources,
}: {
  initial: Filters;
  onChange: (f: Filters) => void;
  categories: string[];
  sources: string[];
}) {
  const [filters, setFilters] = useState<Filters>(initial);
  const update = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    onChange(next);
  };
  return (
    <div className="bg-bg-card border border-white/5 rounded-lg p-3 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
      <input
        type="search"
        placeholder="search by name, description, or tag…"
        value={filters.query}
        onChange={(e) => update({ query: e.target.value })}
        className="flex-1 bg-bg-subtle border border-white/10 rounded px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none"
      />
      <div className="flex gap-2 flex-wrap">
        <select
          value={filters.letter}
          onChange={(e) => update({ letter: e.target.value })}
          className="bg-bg-subtle border border-white/10 rounded px-2 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        >
          <option value="">All grades</option>
          {["S", "A", "B", "C", "D", "F"].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={filters.category}
          onChange={(e) => update({ category: e.target.value })}
          className="bg-bg-subtle border border-white/10 rounded px-2 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={filters.source}
          onChange={(e) => update({ source: e.target.value })}
          className="bg-bg-subtle border border-white/10 rounded px-2 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          onClick={() => update({ query: "", letter: "", category: "", source: "" })}
          className="px-3 py-2 text-sm text-ink-muted hover:text-ink border border-white/10 rounded hover:border-white/20 transition"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
