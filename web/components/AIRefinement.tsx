"use client";

import { useEffect, useRef, useState } from "react";
import {
  detectOllama,
  preferredOllamaModel,
  refineWithOllama,
  refineWithBrowserLLM,
  type LlmRefinement,
  type BrowserLlmProgress,
} from "@/lib/llm-refine";
import type { ExtendedProfile, ProjectArchetype } from "@/lib/architect";
import type { Tool } from "@/lib/data";

/**
 * AIRefinement — auto-running AI augmentation for the architect's analysis.
 *
 * Zero-friction design:
 *   1. On profile change, auto-runs refinement in the background.
 *   2. Tier 1: If Ollama is reachable on localhost, use it (fast, free,
 *      private, no download). Detected silently in ~1s.
 *   3. Tier 2: Otherwise, lazy-load Qwen2.5-0.5B-Instruct via
 *      @huggingface/transformers (Apache 2.0, ~250MB on first visit,
 *      cached in IndexedDB by the browser thereafter).
 *   4. Results cached per-description in sessionStorage so re-renders or
 *      identical re-prompts return instantly.
 *
 * The deterministic detection is never overwritten — the LLM section
 * appears below the breakdown and adds:
 *   - Refined archetype suggestion (validated against canonical id list)
 *   - Additional technical parts the regex didn't catch
 *   - Specific catalog tool names worth investigating
 *   - 1-2 sentence rationale
 */

type RefinementState =
  | { kind: "idle" }
  | { kind: "checking-ollama" }
  | { kind: "loading-browser-model"; progress: BrowserLlmProgress }
  | { kind: "running"; via: "ollama" | "browser"; modelLabel: string }
  | { kind: "done"; result: LlmRefinement }
  | { kind: "error"; message: string };

const SESSION_CACHE_PREFIX = "tool-scout:llm-refinement:v1:";

function cacheKey(description: string): string {
  // Simple hash for sessionStorage key — collision-free for our use
  let h = 0;
  for (let i = 0; i < description.length; i++) {
    h = (h << 5) - h + description.charCodeAt(i);
    h |= 0;
  }
  return `${SESSION_CACHE_PREFIX}${h}`;
}

function readCache(description: string): LlmRefinement | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(cacheKey(description));
    return raw ? (JSON.parse(raw) as LlmRefinement) : null;
  } catch {
    return null;
  }
}

function writeCache(description: string, result: LlmRefinement): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(cacheKey(description), JSON.stringify(result));
  } catch {
    // Quota exceeded or private mode — non-fatal
  }
}

export function AIRefinement({
  profile,
  archetypes,
  tools,
}: {
  profile: ExtendedProfile;
  archetypes: ProjectArchetype[];
  tools: Tool[];
}) {
  const [state, setState] = useState<RefinementState>({ kind: "idle" });

  // Track the description we last ran for, so we don't re-run on unrelated re-renders
  const lastRunFor = useRef<string | null>(null);

  useEffect(() => {
    const desc = profile.description;
    if (!desc || lastRunFor.current === desc) return;
    lastRunFor.current = desc;

    // 1. Cache check — instant return for previously-seen descriptions
    const cached = readCache(desc);
    if (cached) {
      setState({ kind: "done", result: cached });
      return;
    }

    let cancelled = false;
    (async () => {
      // Sample catalog tool names — give the LLM ~80 names to choose from
      const sampleNames = tools
        .filter((t) => t.grade && t.grade.total >= 16)
        .slice(0, 80)
        .map((t) => t.name);

      // 2. Tier 1: Probe Ollama. If available, use it — much faster and
      //    higher quality than the 0.5B browser model.
      setState({ kind: "checking-ollama" });
      const ollama = await detectOllama();
      if (cancelled) return;

      if (ollama.available) {
        const model = preferredOllamaModel(ollama.models);
        setState({ kind: "running", via: "ollama", modelLabel: model });
        try {
          const result = await refineWithOllama(desc, profile, archetypes, sampleNames, {
            baseUrl: "http://localhost:11434",
            model,
          });
          if (cancelled) return;
          writeCache(desc, result);
          setState({ kind: "done", result });
          return;
        } catch (e) {
          if (cancelled) return;
          // Fall through to Tier 2 — Ollama might be running but failing
          console.warn("Ollama refinement failed, falling back to browser model", e);
        }
      }

      // 3. Tier 2: Browser model (Qwen2.5-0.5B-Instruct via transformers.js)
      setState({
        kind: "loading-browser-model",
        progress: { status: "loading", progress: 0 },
      });
      try {
        const result = await refineWithBrowserLLM(
          desc,
          profile,
          archetypes,
          sampleNames,
          (p) => {
            if (cancelled) return;
            // While model is downloading/loading, surface progress in UI
            if (p.status === "downloading" || p.status === "loading") {
              setState({ kind: "loading-browser-model", progress: p });
            } else if (p.status === "ready") {
              setState({ kind: "running", via: "browser", modelLabel: "Qwen2.5-0.5B" });
            }
          },
        );
        if (cancelled) return;
        writeCache(desc, result);
        setState({ kind: "done", result });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setState({ kind: "error", message: msg });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.description]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (state.kind === "idle") return null;

  return (
    <section className="bg-bg-card border border-white/5 rounded-lg p-5">
      <div className="flex items-baseline gap-3 mb-3 flex-wrap">
        <h3 className="font-mono text-base text-ink">AI refinement</h3>
        <RefinementStatusBadge state={state} />
      </div>

      {state.kind === "checking-ollama" && (
        <p className="text-sm text-ink-muted">
          Checking for local AI…
        </p>
      )}

      {state.kind === "loading-browser-model" && (
        <BrowserLoadProgress progress={state.progress} />
      )}

      {state.kind === "running" && (
        <p className="text-sm text-ink-muted">
          Running analysis through{" "}
          <span className="font-mono text-ink">{state.modelLabel}</span>
          {state.via === "ollama" ? " (local)" : " (in your browser)"}…
        </p>
      )}

      {state.kind === "error" && (
        <div className="bg-grade-d/10 border border-grade-d/30 text-grade-d text-sm rounded p-3">
          <span className="font-mono text-xs uppercase mr-2">⚠ AI refinement failed</span>
          <span className="block mt-1 text-ink-muted">{state.message}</span>
          <p className="text-xs text-ink-subtle mt-2">
            The deterministic breakdown above is unaffected. AI refinement is purely additive.
          </p>
        </div>
      )}

      {state.kind === "done" && <RefinementDisplay result={state.result} profileArchetypeId={profile.archetype?.id ?? null} />}
    </section>
  );
}

function RefinementStatusBadge({ state }: { state: RefinementState }) {
  let label = "";
  if (state.kind === "checking-ollama") label = "probing local AI";
  else if (state.kind === "loading-browser-model") label = "loading in-browser model";
  else if (state.kind === "running") label = "thinking";
  else if (state.kind === "done") {
    const b = state.result.backend;
    if (b.kind === "ollama") label = `via ${b.model} (local)`;
    else if (b.kind === "browser") label = `via ${b.modelId} (browser)`;
    else label = "via fallback";
  } else if (state.kind === "error") label = "error";
  return <span className="text-xs text-ink-subtle font-mono">{label}</span>;
}

function BrowserLoadProgress({ progress }: { progress: BrowserLlmProgress }) {
  const pct = Math.round(progress.progress * 100);
  const mb =
    progress.loaded != null && progress.total != null
      ? `${(progress.loaded / 1024 / 1024).toFixed(0)}MB / ${(progress.total / 1024 / 1024).toFixed(0)}MB`
      : null;
  return (
    <div>
      <p className="text-sm text-ink-muted mb-2">
        {progress.status === "downloading"
          ? "Downloading the AI model (one-time, ~250MB, cached for next time)…"
          : progress.status === "loading"
            ? "Initializing the AI model…"
            : "Loading…"}
      </p>
      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <p className="text-xs text-ink-subtle font-mono mt-1.5">
        {pct}% {mb ? `· ${mb}` : ""} {progress.file ? `· ${progress.file}` : ""}
      </p>
      <p className="text-xs text-ink-subtle mt-2">
        Apache 2.0, runs entirely on your device. No tokens, no data leaves your browser.
      </p>
    </div>
  );
}

function RefinementDisplay({
  result,
  profileArchetypeId,
}: {
  result: LlmRefinement;
  profileArchetypeId: string | null;
}) {
  return (
    <div className="space-y-3">
      {result.refinedArchetypeId &&
        result.refinedArchetypeId !== profileArchetypeId && (
          <div className="bg-grade-s/10 border border-grade-s/30 rounded p-3">
            <p className="text-xs font-mono uppercase text-grade-s mb-1">
              Suggested archetype refinement
            </p>
            <p className="text-sm text-ink">
              The AI thinks this might be a closer fit:{" "}
              <span className="font-mono text-grade-s">
                {result.refinedArchetypeLabel ?? result.refinedArchetypeId}
              </span>
            </p>
          </div>
        )}

      {result.additionalTechnicalParts.length > 0 && (
        <div>
          <p className="text-xs font-mono uppercase text-ink-subtle mb-1.5">
            Additional technical parts
          </p>
          <ul className="space-y-1">
            {result.additionalTechnicalParts.map((part, i) => (
              <li key={i} className="text-sm text-ink-muted flex items-start gap-2">
                <span className="text-accent font-mono text-xs pt-0.5">+</span>
                <span>{part}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.suggestedTools.length > 0 && (
        <div>
          <p className="text-xs font-mono uppercase text-ink-subtle mb-1.5">
            Specific tools worth investigating
          </p>
          <div className="flex flex-wrap gap-2">
            {result.suggestedTools.map((tool, i) => (
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

      {result.rationale && (
        <p className="text-xs text-ink-subtle italic mt-2 pt-2 border-t border-white/5">
          {result.rationale}
        </p>
      )}
    </div>
  );
}
