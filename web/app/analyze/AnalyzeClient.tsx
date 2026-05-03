"use client";

import { useEffect, useMemo, useState } from "react";
import { ProjectUpload } from "@/components/ProjectUpload";
import { AnalyzeResults } from "@/components/AnalyzeResults";
import { rankMatches } from "@/lib/match";
import type { ProjectProfile } from "@/lib/analyze";
import type { Tool } from "@/lib/data";

export function AnalyzeClient() {
  const [profile, setProfile] = useState<ProjectProfile | null>(null);
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [toolsErr, setToolsErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Use relative path so it works under any basePath (and on `npm run dev`).
    fetch("./../data/tools.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Tool[]) => {
        if (!cancelled) setTools(data);
      })
      .catch((e) => {
        // Fallback: try without the relative dance (works if route is shallow)
        fetch("./data/tools.json")
          .then((r) => r.json())
          .then((data: Tool[]) => {
            if (!cancelled) setTools(data);
          })
          .catch(() => {
            if (!cancelled) setToolsErr(e instanceof Error ? e.message : String(e));
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const matches = useMemo(() => {
    if (!profile || !tools) return [];
    return rankMatches(tools, profile, 12);
  }, [profile, tools]);

  if (toolsErr) {
    return (
      <p className="text-sm text-grade-d">
        ⚠ Couldn't load the catalog ({toolsErr}). Refresh and try again.
      </p>
    );
  }

  if (!tools) {
    return (
      <div className="bg-bg-card border border-white/5 rounded-lg p-12 text-center text-ink-muted text-sm">
        loading catalog…
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-3">
        <ProjectUpload onProfile={setProfile} />
        <p className="text-xs text-ink-subtle text-right">
          Catalog loaded · {tools.length.toLocaleString()} tools ready to match
        </p>
      </div>
    );
  }
  return (
    <AnalyzeResults
      profile={profile}
      matches={matches}
      onReset={() => setProfile(null)}
    />
  );
}
