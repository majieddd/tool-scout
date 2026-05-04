"use client";

import { useEffect, useState } from "react";
import {
  detectOllama,
  preferredOllamaModel,
  refineWithOllama,
  type LlmRefinement,
} from "@/lib/llm-refine";
import type { ExtendedProfile, ProjectArchetype } from "@/lib/architect";
import type { Tool } from "@/lib/data";

/**
 * AIRefinement — opt-in AI augmentation for the architect's analysis.
 *
 * Behavior:
 *   1. On mount, probes localhost for a running Ollama (cheap, ~1s timeout).
 *   2. If found, surfaces a "Refine with local Ollama" button.
 *   3. If not, shows a setup hint with the one-line install command and the
 *      CORS env var the user needs (Ollama doesn't allow cross-origin
 *      browser fetches by default).
 *   4. On click, sends the description + detected profile + small catalog
 *      sample to Ollama, parses the structured JSON response, renders a
 *      separate "AI suggestions" card BELOW the deterministic breakdown.
 *      The deterministic detection is never overwritten — the LLM augments.
 *
 * Privacy: all inference is local. Nothing leaves the browser unless the
 * user explicitly bridges to a remote Ollama (advanced).
 */
export function AIRefinement({
  profile,
  archetypes,
  tools,
}: {
  profile: ExtendedProfile;
  archetypes: ProjectArchetype[];
  tools: Tool[];
}) {
  const [status, setStatus] = useState<
    | { kind: "checking" }
    | { kind: "available"; models: string[]; preferred: string }
    | { kind: "unavailable"; reason: string }
  >({ kind: "checking" });

  const [refinement, setRefinement] = useState<LlmRefinement | null>(null);
  const [refinementError, setRefinementError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  // Probe Ollama once on mount
  useEffect(() => {
    let cancelled = false;
    detectOllama().then((r) => {
      if (cancelled) return;
      if (r.available) {
        const preferred = preferredOllamaModel(r.models);
        setStatus({ kind: "available", models: r.models, preferred });
        setSelectedModel(preferred);
      } else {
        setStatus({ kind: "unavailable", reason: r.reason });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runRefinement() {
    if (status.kind !== "available" || !selectedModel) return;
    setRunning(true);
    setRefinementError(null);
    setRefinement(null);
    try {
      // Sample catalog tool names — give the LLM ~80 names to choose from
      const sampleNames = tools
        .filter((t) => t.grade && t.grade.total >= 16)
        .slice(0, 80)
        .map((t) => t.name);
      const result = await refineWithOllama(profile.description, profile, archetypes, sampleNames, {
        baseUrl: "http://localhost:11434",
        model: selectedModel,
      });
      setRefinement(result);
    } catch (e) {
      setRefinementError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  // ── Status: probing ──
  if (status.kind === "checking") {
    return (
      <section className="bg-bg-card border border-white/5 rounded-lg p-4 text-sm text-ink-subtle">
        Checking for local AI…
      </section>
    );
  }

  // ── Status: not available — show install hint ──
  if (status.kind === "unavailable") {
    return (
      <section className="bg-bg-card border border-white/5 rounded-lg p-5">
        <h3 className="font-mono text-base text-ink mb-2">Optional: AI refinement</h3>
        <p className="text-sm text-ink-muted mb-3">
          You&apos;re seeing the deterministic analysis above. For an extra
          AI-augmented pass — suggested by a local LLM running on your own
          machine, no tokens, no data leaves your device — install Ollama
          and start it with cross-origin fetches enabled:
        </p>
        <pre className="bg-bg text-xs text-ink-muted font-mono p-3 rounded overflow-x-auto border border-white/5">
{`# 1. Install Ollama (if you don't have it)
#    macOS / Linux: curl -fsSL https://ollama.com/install.sh | sh
#    Windows: download from https://ollama.com/download

# 2. Pull a small Apache-2.0 model
ollama pull qwen2.5:0.5b   # ~400MB, fast, Apache 2.0
# or:
ollama pull gemma3:4b      # ~3GB, more capable

# 3. Restart Ollama with browser CORS allowed
OLLAMA_ORIGINS='*' ollama serve

# Then refresh this page.`}
        </pre>
        <p className="text-xs text-ink-subtle mt-2">
          Why? <code className="font-mono">{status.reason}</code>
        </p>
      </section>
    );
  }

  // ── Status: available ──
  return (
    <section className="bg-bg-card border border-white/5 rounded-lg p-5">
      <div className="flex items-baseline gap-3 mb-3">
        <h3 className="font-mono text-base text-ink">AI refinement</h3>
        <span className="text-xs text-ink-subtle font-mono">
          local Ollama detected · {status.models.length} model{status.models.length !== 1 ? "s" : ""}
        </span>
      </div>
      <p className="text-sm text-ink-muted mb-3">
        The deterministic breakdown above is rule-based. Run an extra AI
        pass through a local model to refine the archetype, suggest
        additional technical parts, and pinpoint specific tools to
        investigate. All inference is local — no tokens, no data leaves
        your device.
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="text-xs text-ink-subtle font-mono">model:</label>
        <select
          value={selectedModel ?? status.preferred}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={running}
          className="bg-bg border border-white/10 rounded px-2 py-1 text-xs font-mono text-ink"
        >
          {status.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          onClick={runRefinement}
          disabled={running}
          className="ml-auto bg-accent text-bg px-3 py-1.5 rounded text-sm font-medium hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? "Refining…" : refinement ? "Run again" : "Refine with AI ✨"}
        </button>
      </div>

      {refinementError && (
        <div className="bg-grade-d/10 border border-grade-d/30 text-grade-d text-sm rounded p-3 mt-2">
          <span className="font-mono text-xs uppercase mr-2">⚠ error</span>
          {refinementError}
        </div>
      )}

      {refinement && (
        <div className="mt-4 space-y-3 border-t border-white/5 pt-4">
          {refinement.refinedArchetypeId &&
            refinement.refinedArchetypeId !== profile.archetype?.id && (
              <div className="bg-grade-s/10 border border-grade-s/30 rounded p-3">
                <p className="text-xs font-mono uppercase text-grade-s mb-1">
                  Suggested archetype refinement
                </p>
                <p className="text-sm text-ink">
                  The LLM thinks this might be a better fit:{" "}
                  <span className="font-mono text-grade-s">
                    {refinement.refinedArchetypeLabel ?? refinement.refinedArchetypeId}
                  </span>
                </p>
              </div>
            )}

          {refinement.additionalTechnicalParts.length > 0 && (
            <div>
              <p className="text-xs font-mono uppercase text-ink-subtle mb-1.5">
                Additional technical parts (LLM-suggested)
              </p>
              <ul className="space-y-1">
                {refinement.additionalTechnicalParts.map((part, i) => (
                  <li key={i} className="text-sm text-ink-muted flex items-start gap-2">
                    <span className="text-accent font-mono text-xs pt-0.5">+</span>
                    <span>{part}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {refinement.suggestedTools.length > 0 && (
            <div>
              <p className="text-xs font-mono uppercase text-ink-subtle mb-1.5">
                Specific tools worth investigating
              </p>
              <div className="flex flex-wrap gap-2">
                {refinement.suggestedTools.map((tool, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-white/5 text-ink-muted border border-white/10"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}

          {refinement.rationale && (
            <p className="text-xs text-ink-subtle italic mt-2 pt-2 border-t border-white/5">
              {refinement.rationale}
            </p>
          )}

          <p className="text-[10px] text-ink-subtle font-mono">
            via{" "}
            {refinement.backend.kind === "ollama"
              ? `Ollama / ${refinement.backend.model}`
              : "browser LLM"}
          </p>
        </div>
      )}
    </section>
  );
}
