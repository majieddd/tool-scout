"use client";

import Link from "next/link";
import { GradeBadge } from "./GradeBadge";
import {
  AGENT_LABELS,
  GOAL_LABELS,
  PLATFORM_LABELS,
  type ExtendedProfile,
} from "@/lib/architect";
import type { ComposedStack } from "@/lib/stack-builder";
import type { Warning } from "@/lib/compat-check";

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "lang" | "fw" | "marker" | "agent" | "goal" }) {
  const cls =
    tone === "lang" ? "bg-grade-b/20 text-grade-b border-grade-b/30"
    : tone === "fw" ? "bg-accent/20 text-accent border-accent/30"
    : tone === "marker" ? "bg-grade-a/20 text-grade-a border-grade-a/30"
    : tone === "agent" ? "bg-grade-s/20 text-grade-s border-grade-s/30"
    : tone === "goal" ? "bg-grade-c/20 text-grade-c border-grade-c/30"
    : "bg-white/5 text-ink-muted border-white/10";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono border ${cls}`}>
      {children}
    </span>
  );
}

export function StackComposition({
  profile,
  stack,
  warnings,
  onReset,
  onGeneratePrompt,
}: {
  profile: ExtendedProfile;
  stack: ComposedStack;
  warnings: Warning[];
  onReset: () => void;
  onGeneratePrompt: () => void;
}) {
  return (
    <div className="space-y-8">
      {/* Detected ----------------------------------------------------- */}
      <section className="bg-bg-card border border-white/5 rounded-lg p-5">
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <h2 className="font-mono text-lg text-ink">Detected</h2>
          <button onClick={onReset} className="text-sm text-ink-muted hover:text-ink">
            ← start over
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip tone="goal">{GOAL_LABELS[profile.goal]}</Chip>
          <Chip tone="agent">{AGENT_LABELS[profile.targetAgent]}</Chip>
          <Chip>{PLATFORM_LABELS[profile.platform]}</Chip>
          {profile.primaryLanguage && <Chip tone="lang">{profile.primaryLanguage}</Chip>}
          {[...profile.frameworks].slice(0, 6).map((fw) => (
            <Chip key={fw} tone="fw">{fw}</Chip>
          ))}
          {profile.domains.slice(0, 8).map((d) => (
            <Chip key={d}>{d}</Chip>
          ))}
          {profile.hasDocker && <Chip tone="marker">Docker</Chip>}
          {profile.hasTests && <Chip tone="marker">Tests</Chip>}
          {profile.hasMcp && <Chip tone="marker">MCP-aware</Chip>}
        </div>
      </section>

      {/* Archetype breakdown -------------------------------------------
        Renders when the user described what they want to build in plain
        English ("an app that trades on the stock market") instead of
        naming technologies. The architect decomposes it into the
        technical parts they'll need so the recommendations make sense
        in context. */}
      {stack.archetype && (
        <section className="bg-bg-card border border-white/5 rounded-lg p-5">
          <div className="flex items-baseline gap-3 mb-1">
            <h2 className="font-mono text-lg text-ink">Your project breakdown</h2>
            <span className="text-xs text-ink-subtle font-mono">
              detected: {stack.archetype.label}
            </span>
          </div>
          <p className="text-sm text-ink-muted mt-2 mb-4">{stack.archetype.summary}</p>
          <div className="space-y-1.5">
            <p className="text-xs font-mono uppercase text-ink-subtle">
              Technical parts you&apos;ll need
            </p>
            <ul className="space-y-1.5">
              {stack.archetype.technicalParts.map((part, i) => (
                <li key={i} className="text-sm text-ink-muted flex items-start gap-2">
                  <span className="text-accent font-mono text-xs pt-0.5">
                    {(i + 1).toString().padStart(2, "0")}
                  </span>
                  <span>{part}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4 pt-3 border-t border-white/5">
            <p className="text-xs font-mono uppercase text-ink-subtle mb-1">
              Typical stack for this archetype
            </p>
            <p className="text-sm text-ink-muted font-mono">{stack.archetype.exampleStack}</p>
          </div>

          {/* Essential off-catalog libraries -------------------------------
            The catalog is curated for agent-tooling MCPs / plugins / skills,
            so domain apps (trading, voice, scraping, RAG, agents) need
            standard pip / npm libraries the catalog doesn't try to mirror.
            Surfacing them here is the actionable bridge between the
            technical-parts checklist and the (often slim) catalog picks
            below — instead of a 9-item breakdown ending in 2 random MCPs. */}
          {stack.archetype.essentialLibraries.length > 0 && (
            <div className="mt-4 pt-3 border-t border-white/5">
              <p className="text-xs font-mono uppercase text-ink-subtle mb-1">
                Essential libraries to install yourself
              </p>
              <p className="text-xs text-ink-subtle mb-2.5">
                These aren&apos;t in the catalog (it&apos;s curated for agent-tooling MCPs / plugins / skills).
                They&apos;re standard domain libraries — install commands are copy-pasteable.
              </p>
              <ul className="space-y-2.5">
                {stack.archetype.essentialLibraries.map((lib, i) => (
                  <li key={i} className="space-y-1">
                    <div className="flex items-baseline gap-3 flex-wrap">
                      <span className="font-mono text-sm text-ink">{lib.name}</span>
                      <span className="text-xs text-ink-muted">— {lib.why}</span>
                    </div>
                    <pre className="px-2 py-1 bg-bg/60 border border-white/5 rounded text-[11px] text-ink-muted font-mono overflow-x-auto">
                      {lib.install}
                    </pre>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-ink-subtle mt-3 italic">
            The recommendations below are filtered by the inferred technical needs above.
            Refine your description to override these guesses.
          </p>
        </section>
      )}

      {/* Warnings ----------------------------------------------------- */}
      {warnings.length > 0 && (
        <section className="space-y-2">
          {warnings.map((w, i) => (
            <div
              key={i}
              className={`rounded-lg p-3 text-sm border ${
                w.severity === "warn"
                  ? "bg-grade-d/10 border-grade-d/30 text-grade-d"
                  : "bg-grade-c/10 border-grade-c/30 text-grade-c"
              }`}
            >
              <span className="font-mono text-xs uppercase mr-2">
                {w.severity === "warn" ? "⚠ warn" : "ℹ info"}
              </span>
              {w.message}
            </div>
          ))}
        </section>
      )}

      {/* Stack -------------------------------------------------------- */}
      <section>
        <header className="mb-4 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="font-mono text-lg text-ink">
              Recommended stack — {stack.totalPrimaryCount} picks
            </h2>
            <p className="text-xs text-ink-subtle mt-0.5">
              Capped at 15 to avoid overload. Layers without strong matches are skipped.
            </p>
          </div>
          {stack.totalPrimaryCount >= 1 && (
            <button
              onClick={onGeneratePrompt}
              className="px-4 py-2 bg-accent/90 hover:bg-accent text-bg rounded font-medium text-sm transition shrink-0"
            >
              Generate starter prompt →
            </button>
          )}
        </header>

        {stack.layers.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No strong matches. Try adding more detail to your description — target agent, primary
            language, key domains.
          </p>
        ) : (
          <ol className="space-y-4">
            {stack.layers.map((layer, i) => (
              <li
                key={layer.id}
                className="bg-bg-card border border-white/5 rounded-lg p-4"
              >
                <header className="mb-3 flex items-baseline gap-3">
                  <span className="font-mono text-xs text-ink-subtle tabular-nums w-6 shrink-0">
                    {(i + 1).toString().padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-mono text-sm text-ink">{layer.name}</h3>
                    <p className="text-xs text-ink-muted mt-0.5 max-w-2xl">{layer.description}</p>
                  </div>
                </header>

                <div className="ml-9 space-y-2">
                  {layer.primary.map((p) => (
                    <Link
                      key={p.tool.id}
                      href={`/tool/${p.tool.id}/`}
                      className="flex items-start gap-3 bg-bg-subtle border border-white/5 rounded p-3 hover:border-accent/40 transition group"
                    >
                      <GradeBadge letter={p.tool.grade?.letter || "F"} size="sm" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <h4 className="font-mono text-sm text-ink truncate group-hover:text-accent transition">
                            {p.tool.name}
                          </h4>
                          <span className="text-[11px] text-ink-subtle shrink-0 font-mono">
                            {p.reason}
                          </span>
                        </div>
                        {p.tool.description && (
                          <p className="text-xs text-ink-muted mt-0.5 line-clamp-1">
                            {p.tool.description}
                          </p>
                        )}
                        {p.tool.install_hint && (
                          <pre className="mt-1.5 px-2 py-1 bg-bg/60 border border-white/5 rounded text-[10px] text-ink-muted font-mono overflow-x-auto">
                            {p.tool.install_hint.split("\n")[0]}
                          </pre>
                        )}
                      </div>
                    </Link>
                  ))}

                  {layer.alternatives.length > 0 && (
                    <details className="mt-1">
                      <summary className="text-[11px] text-ink-subtle cursor-pointer hover:text-ink-muted transition list-none">
                        ▸ {layer.alternatives.length} alternative{layer.alternatives.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-1.5 space-y-1">
                        {layer.alternatives.map((alt) => (
                          <li key={alt.tool.id}>
                            <Link
                              href={`/tool/${alt.tool.id}/`}
                              className="flex items-baseline gap-3 text-xs hover:text-ink transition"
                            >
                              <span className="font-mono w-3 shrink-0 text-center text-ink-subtle">
                                {alt.tool.grade?.letter}
                              </span>
                              <span className="font-mono text-ink-muted truncate">{alt.tool.name}</span>
                              <span className="text-ink-subtle truncate">{alt.tool.description}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {stack.totalPrimaryCount > 0 && (
        <section className="text-center pt-4">
          <button
            onClick={onGeneratePrompt}
            className="px-6 py-3 bg-accent hover:bg-accent/90 text-bg rounded font-medium text-sm transition"
          >
            Generate starter prompt →
          </button>
          <p className="text-xs text-ink-subtle mt-2">
            Optional. Asks 4-5 quick questions and produces a paste-ready agent prompt with install
            commands and phased implementation steps.
          </p>
        </section>
      )}
    </div>
  );
}
