"use client";

import { useCallback, useRef, useState } from "react";
import { analyzeFile, analyzeText, analyzeZip, type ProjectProfile } from "@/lib/analyze";

type Mode = "drop" | "paste";

export function ProjectUpload({ onProfile }: { onProfile: (p: ProjectProfile) => void }) {
  const [mode, setMode] = useState<Mode>("drop");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const [isDrag, setIsDrag] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setProgress("reading…");
      try {
        const isZip =
          file.name.toLowerCase().endsWith(".zip") ||
          file.type === "application/zip" ||
          file.type === "application/x-zip-compressed";
        const profile = isZip
          ? await analyzeZip(file, (m) => setProgress(m))
          : await analyzeFile(file);
        onProfile(profile);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
        setProgress("");
      }
    },
    [onProfile]
  );

  const handlePaste = useCallback(() => {
    if (!pasteText.trim()) {
      setError("paste something first — a package.json, requirements.txt, or any project text");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const profile = analyzeText(pasteText);
      onProfile(profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [pasteText, onProfile]);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-bg-card border border-white/10 rounded-lg p-1 w-fit">
        <button
          onClick={() => setMode("drop")}
          className={`px-3 py-1.5 rounded text-sm transition ${
            mode === "drop" ? "bg-accent/30 text-ink" : "text-ink-muted hover:text-ink"
          }`}
        >
          Upload zip or file
        </button>
        <button
          onClick={() => setMode("paste")}
          className={`px-3 py-1.5 rounded text-sm transition ${
            mode === "paste" ? "bg-accent/30 text-ink" : "text-ink-muted hover:text-ink"
          }`}
        >
          Paste text
        </button>
      </div>

      {mode === "drop" && (
        <div
          ref={dragRef}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDrag(true);
          }}
          onDragLeave={() => setIsDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`relative cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition ${
            isDrag
              ? "border-accent bg-accent/10"
              : "border-white/15 hover:border-accent/50 hover:bg-bg-subtle"
          } ${busy ? "opacity-60 pointer-events-none" : ""}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".zip,.json,.toml,.txt,.yaml,.yml,.lock,.md"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="w-10 h-10 mx-auto text-ink-subtle mb-3"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 7.5m0 0L7.5 12m4.5-4.5v12" />
          </svg>
          <p className="text-ink font-mono text-sm">
            {busy ? progress || "analyzing…" : "Drop a project zip here, or click to upload"}
          </p>
          <p className="text-ink-subtle text-xs mt-2">
            Or one of: <code className="text-ink-muted">package.json</code>,{" "}
            <code className="text-ink-muted">pyproject.toml</code>,{" "}
            <code className="text-ink-muted">requirements.txt</code>,{" "}
            <code className="text-ink-muted">Cargo.toml</code>,{" "}
            <code className="text-ink-muted">go.mod</code>, README, …
          </p>
          <p className="text-ink-subtle text-xs mt-1">
            Stays in your browser — nothing is uploaded.
          </p>
        </div>
      )}

      {mode === "paste" && (
        <div className="space-y-2">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={`Paste anything: a package.json snippet, a requirements.txt, a README, or a free-text description of what your project does.\n\ne.g.\n  fastapi==0.111\n  sqlalchemy>=2\n  pydantic>=2\n\n  We're building an MCP server for Postgres with auth and rate limits.`}
            className="w-full min-h-[180px] bg-bg-subtle border border-white/10 rounded p-3 text-sm text-ink placeholder:text-ink-subtle focus:border-accent focus:outline-none font-mono"
          />
          <div className="flex justify-end">
            <button
              onClick={handlePaste}
              disabled={busy || !pasteText.trim()}
              className="px-4 py-2 bg-accent/90 hover:bg-accent disabled:bg-bg-subtle disabled:text-ink-subtle text-bg rounded text-sm font-medium transition"
            >
              {busy ? "analyzing…" : "Analyze"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-grade-d">⚠ {error}</p>
      )}
    </div>
  );
}
