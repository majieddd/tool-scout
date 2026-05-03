"use client";

import { useEffect, useMemo, useState } from "react";
import { ArchitectInput } from "@/components/ArchitectInput";
import { StackComposition } from "@/components/StackComposition";
import { PromptModal } from "@/components/PromptModal";
import { composeStack, type ComposedStack } from "@/lib/stack-builder";
import { checkCompat, type Warning } from "@/lib/compat-check";
import type { ExtendedProfile } from "@/lib/architect";
import type { Tool } from "@/lib/data";

export function ArchitectClient() {
  const [profile, setProfile] = useState<ExtendedProfile | null>(null);
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [toolsErr, setToolsErr] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("./../data/tools.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Tool[]) => {
        if (!cancelled) setTools(data);
      })
      .catch((e) => {
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

  const composed: { stack: ComposedStack; warnings: Warning[] } | null = useMemo(() => {
    if (!profile || !tools) return null;
    const stack = composeStack(tools, profile);
    const warnings = checkCompat(stack, profile);
    return { stack, warnings };
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
        <ArchitectInput onCompose={setProfile} />
        <p className="text-xs text-ink-subtle text-right">
          Catalog loaded · {tools.length.toLocaleString()} tools ready to match
        </p>
      </div>
    );
  }

  return (
    <>
      <StackComposition
        profile={profile}
        stack={composed!.stack}
        warnings={composed!.warnings}
        onReset={() => setProfile(null)}
        onGeneratePrompt={() => setShowPrompt(true)}
      />
      {showPrompt && composed && (
        <PromptModal
          profile={profile}
          stack={composed.stack}
          onClose={() => setShowPrompt(false)}
        />
      )}
    </>
  );
}
