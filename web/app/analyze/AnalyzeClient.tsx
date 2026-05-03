"use client";

import { useMemo, useState } from "react";
import { ProjectUpload } from "@/components/ProjectUpload";
import { AnalyzeResults } from "@/components/AnalyzeResults";
import { rankMatches } from "@/lib/match";
import type { ProjectProfile } from "@/lib/analyze";
import type { Tool } from "@/lib/data";

export function AnalyzeClient({ tools }: { tools: Tool[] }) {
  const [profile, setProfile] = useState<ProjectProfile | null>(null);

  const matches = useMemo(() => {
    if (!profile) return [];
    return rankMatches(tools, profile, 12);
  }, [profile, tools]);

  if (!profile) {
    return <ProjectUpload onProfile={setProfile} />;
  }
  return (
    <AnalyzeResults
      profile={profile}
      matches={matches}
      onReset={() => setProfile(null)}
    />
  );
}
