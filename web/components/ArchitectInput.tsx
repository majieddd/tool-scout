"use client";

import { useCallback, useRef, useState } from "react";
import { analyzeFile, analyzeText, analyzeZip } from "@/lib/analyze";
import { extractFromDescription, mergeProfiles, type ExtendedProfile } from "@/lib/architect";

export function ArchitectInput({
  onCompose,
}: {
  onCompose: (p: ExtendedProfile) => void;
}) {
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [isDrag, setIsDrag] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(async () => {
    if (!description.trim() && !pendingFile && !pendingText.trim()) {
      setError("Tell us about your project, drop a zip, or paste a spec — at least one.");
      return;
    }
    setBusy(true);
    setError(null);

    try {
      // 1. Description signals
      const descProfile = extractFromDescription(description.trim());

      // 2. Optional code/spec signals
      let codeProfile = null;
      if (pendingFile) {
        setProgress("reading file…");
        const isZip =
          pendingFile.name.toLowerCase().endsWith(".zip") ||
          pendingFile.type === "application/zip" ||
          pendingFile.type === "application/x-zip-compressed";
        codeProfile = isZip
          ? await analyzeZip(pendingFile, (m) => setProgress(m))
          : await analyzeFile(pendingFile);
      } else if (pendingText.trim()) {
        codeProfile = analyzeText(pendingText.trim());
      }

      // 3. Merge
      const merged = codeProfile ? mergeProfiles(codeProfile, descProfile) : descProfile;

      onCompose(merged);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }, [description, pendingFile, pendingText, onCompose]);

  return (
    <div className="space-y-5">
      {/* Description ------------------------------------------------- */}
      <div>
        <label className="block text-sm text-ink mb-2 font-mono">
          Describe your project
          <span className="text-ink-subtle font-normal"> · what are you building, for which agent, on what stack?</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={`e.g. "I'm building a Claude Code MCP server in Python that lets the agent query our Postgres database with row-level auth. Running on Windows 11 with Docker. I want test-driven development."`}
          className="w-full min-h-[140px] bg-bg-subtle border border-white/10 rounded p-3 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none font-mono resize-y"
        />
        <p className="text-xs text-ink-subtle mt-1">
          The more specific (target agent, language, key domains, constraints), the tighter the stack.
        </p>
      </div>

      {/* Optional file/spec ------------------------------------------ */}
      <details className="bg-bg-card border border-white/5 rounded-lg p-3 group">
        <summary className="cursor-pointer text-sm text-ink-muted hover:text-ink transition list-none flex items-center justify-between">
          <span>Add code or spec sheet <span className="text-ink-subtle">(optional)</span></span>
          <span className="text-ink-subtle text-xs group-open:rotate-90 transition">▸</span>
        </summary>
        <div className="mt-3 space-y-3">
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDrag(true); }}
            onDragLeave={() => setIsDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDrag(false);
              const f = e.dataTransfer.files?.[0];
              if (f) setPendingFile(f);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center text-sm transition ${
              isDrag ? "border-accent bg-accent/10" : "border-white/15 hover:border-accent/50 hover:bg-bg-subtle"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".zip,.json,.toml,.txt,.yaml,.yml,.lock,.md,.rst"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setPendingFile(f);
              }}
            />
            {pendingFile ? (
              <div className="flex items-center justify-center gap-3">
                <span className="font-mono text-xs text-ink">{pendingFile.name}</span>
                <span className="text-ink-subtle text-xs">{Math.round(pendingFile.size / 1024)} KB</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setPendingFile(null); }}
                  className="text-xs text-ink-muted hover:text-grade-d"
                >
                  remove
                </button>
              </div>
            ) : (
              <p className="text-ink-muted">
                Drop a zip, manifest, or spec.md — or click to choose.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-ink-subtle mb-1.5">Or paste a spec / requirements list:</label>
            <textarea
              value={pendingText}
              onChange={(e) => setPendingText(e.target.value)}
              placeholder="(optional) requirements.txt content, a prose spec, etc."
              className="w-full min-h-[80px] bg-bg-subtle border border-white/10 rounded p-2 text-xs text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none font-mono resize-y"
            />
          </div>
        </div>
      </details>

      {/* Submit ------------------------------------------------------ */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-subtle">
          🔒 Everything is processed in your browser. Nothing is uploaded.
        </p>
        <button
          onClick={handleSubmit}
          disabled={busy}
          className="px-5 py-2.5 bg-accent/90 hover:bg-accent disabled:bg-bg-subtle disabled:text-ink-subtle text-bg rounded font-medium text-sm transition"
        >
          {busy ? (progress || "composing…") : "Compose stack →"}
        </button>
      </div>

      {error && (
        <div className="bg-grade-d/10 border border-grade-d/30 rounded p-3 text-sm text-grade-d">
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
