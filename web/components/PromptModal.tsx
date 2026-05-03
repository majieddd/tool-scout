"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AGENT_LABELS,
  GOAL_LABELS,
  PLATFORM_LABELS,
  type AgentTarget,
  type ExtendedProfile,
  type Platform,
} from "@/lib/architect";
import { buildPrompt, type PromptStyle } from "@/lib/prompt-builder";
import type { ComposedStack } from "@/lib/stack-builder";

const AGENT_OPTIONS: AgentTarget[] = [
  "claude-code", "claude-desktop", "codex-cli", "cursor", "cline",
  "continue", "aider", "windsurf", "cody", "zed", "gemini", "generic",
];
const PLATFORM_OPTIONS: Platform[] = ["windows", "macos", "linux", "wsl", "cloud", "mobile"];
const STYLE_OPTIONS: PromptStyle[] = ["tdd", "rapid", "guided"];
const STYLE_LABELS: Record<PromptStyle, string> = {
  tdd: "Test-driven (write test, watch fail, write code, watch pass)",
  rapid: "Rapid spike (happy path first, harden later)",
  guided: "Guided step-by-step (confirm at each major decision)",
};

export function PromptModal({
  profile,
  stack,
  onClose,
}: {
  profile: ExtendedProfile;
  stack: ComposedStack;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"q" | "preview">("q");
  const [goal, setGoal] = useState(
    profile.goal !== "general" ? GOAL_LABELS[profile.goal].toLowerCase() : ""
  );
  const [targetAgent, setTargetAgent] = useState<AgentTarget>(
    profile.targetAgent !== "unknown" ? profile.targetAgent : "claude-code"
  );
  const [platform, setPlatform] = useState<Platform>(
    profile.platform !== "unknown" ? profile.platform : "windows"
  );
  const [style, setStyle] = useState<PromptStyle>("tdd");
  const [multiSession, setMultiSession] = useState(true);
  const [includeRefs, setIncludeRefs] = useState(true);
  const [copied, setCopied] = useState(false);

  // Lock body scroll while modal open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const prompt = useMemo(() => {
    if (step !== "preview") return "";
    return buildPrompt(stack, profile, {
      goal: goal || "(unnamed project)",
      targetAgent,
      platform,
      style,
      multiSession,
      includeWebReferences: includeRefs,
    });
  }, [step, stack, profile, goal, targetAgent, platform, style, multiSession, includeRefs]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore — fallback handled by selecting the textarea
    }
  };

  const download = () => {
    const blob = new Blob([prompt], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeGoal = (goal || "starter-prompt").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40);
    a.download = `tool-scout-${safeGoal}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-bg-card border border-white/10 rounded-lg max-w-3xl w-full my-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "q" ? (
          <div className="p-6 space-y-5">
            <header className="flex items-baseline justify-between">
              <h2 className="font-mono text-lg text-ink">A few quick questions</h2>
              <button onClick={onClose} className="text-ink-subtle hover:text-ink text-sm">
                ✕ close
              </button>
            </header>
            <p className="text-sm text-ink-muted">
              Most of these are pre-filled from what we detected — confirm or change.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-ink mb-1.5 font-mono">
                  1. One-line goal
                </label>
                <input
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="e.g. build an MCP server for our Postgres database"
                  className="w-full bg-bg-subtle border border-white/10 rounded p-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none font-mono"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-ink mb-1.5 font-mono">
                    2. Target agent
                  </label>
                  <select
                    value={targetAgent}
                    onChange={(e) => setTargetAgent(e.target.value as AgentTarget)}
                    className="w-full bg-bg-subtle border border-white/10 rounded p-2 text-sm text-ink focus:border-accent focus:outline-none"
                  >
                    {AGENT_OPTIONS.map((a) => (
                      <option key={a} value={a}>{AGENT_LABELS[a]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-ink mb-1.5 font-mono">
                    3. Platform
                  </label>
                  <select
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value as Platform)}
                    className="w-full bg-bg-subtle border border-white/10 rounded p-2 text-sm text-ink focus:border-accent focus:outline-none"
                  >
                    {PLATFORM_OPTIONS.map((p) => (
                      <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-ink mb-1.5 font-mono">
                  4. Implementation style
                </label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value as PromptStyle)}
                  className="w-full bg-bg-subtle border border-white/10 rounded p-2 text-sm text-ink focus:border-accent focus:outline-none"
                >
                  {STYLE_OPTIONS.map((s) => (
                    <option key={s} value={s}>{STYLE_LABELS[s]}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={multiSession}
                    onChange={(e) => setMultiSession(e.target.checked)}
                    className="accent-accent"
                  />
                  5. This will span multiple agent sessions (include HANDOFF.md instructions)
                </label>
                <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeRefs}
                    onChange={(e) => setIncludeRefs(e.target.checked)}
                    className="accent-accent"
                  />
                  Include catalog links for each tool (verbose but auditable)
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-white/5">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-ink-muted hover:text-ink transition"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep("preview")}
                className="px-4 py-2 bg-accent/90 hover:bg-accent text-bg rounded font-medium text-sm transition"
              >
                Generate
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <header className="flex items-baseline justify-between gap-3">
              <h2 className="font-mono text-lg text-ink">Your starter prompt</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep("q")}
                  className="text-sm text-ink-muted hover:text-ink"
                >
                  ← edit
                </button>
                <button onClick={onClose} className="text-ink-subtle hover:text-ink text-sm">
                  ✕ close
                </button>
              </div>
            </header>
            <p className="text-xs text-ink-subtle">
              Copy this into a new <code className="text-ink">.md</code> file or paste directly into your agent. {prompt.split("\n").length} lines · {prompt.length.toLocaleString()} chars.
            </p>
            <textarea
              readOnly
              value={prompt}
              className="w-full h-[60vh] bg-bg-subtle border border-white/10 rounded p-3 text-xs text-ink font-mono resize-none"
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            />
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                onClick={download}
                className="px-3 py-1.5 text-sm border border-white/10 rounded hover:border-accent/40 hover:text-accent transition"
              >
                Download .md
              </button>
              <button
                onClick={copy}
                className="px-4 py-2 bg-accent/90 hover:bg-accent text-bg rounded font-medium text-sm transition"
              >
                {copied ? "Copied ✓" : "Copy to clipboard"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
