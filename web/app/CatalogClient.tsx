"use client";

import { useMemo, useState } from "react";
import { FilterBar, type Filters } from "@/components/FilterBar";
import { ToolCard } from "@/components/ToolCard";
import type { Tool } from "@/lib/data";

const PAGE_SIZE = 60;

export function CatalogClient({
  tools,
  categories,
  sources,
}: {
  tools: Tool[];
  categories: string[];
  sources: string[];
}) {
  const [filters, setFilters] = useState<Filters>({
    query: "",
    letter: "",
    category: "",
    source: "",
  });
  const [shown, setShown] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return tools.filter((t) => {
      if (filters.letter && (t.grade?.letter || "").toUpperCase() !== filters.letter) return false;
      if (filters.category && t.category !== filters.category) return false;
      if (filters.source && t.source !== filters.source) return false;
      if (q) {
        const hay =
          (t.name || "").toLowerCase() +
          " " +
          (t.description || "").toLowerCase() +
          " " +
          (t.tags || []).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tools, filters]);

  const visible = filtered.slice(0, shown);

  return (
    <div className="space-y-6">
      <FilterBar
        initial={filters}
        onChange={(f) => {
          setFilters(f);
          setShown(PAGE_SIZE);
        }}
        categories={categories}
        sources={sources}
      />
      <div className="text-xs text-ink-subtle font-mono">
        {filtered.length.toLocaleString()} match
        {filtered.length === 1 ? "" : "es"} · showing {Math.min(shown, filtered.length)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {visible.map((t) => (
          <ToolCard key={t.id} tool={t} />
        ))}
      </div>
      {visible.length < filtered.length && (
        <div className="text-center pt-4">
          <button
            onClick={() => setShown((s) => s + PAGE_SIZE)}
            className="px-4 py-2 text-sm bg-bg-card border border-white/10 rounded hover:border-accent/40 hover:bg-bg-subtle transition"
          >
            Load {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
          </button>
        </div>
      )}
    </div>
  );
}
