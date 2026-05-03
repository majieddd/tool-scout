import { AnalyzeClient } from "./AnalyzeClient";

export const metadata = {
  title: "Project Analyze — Tool Scout",
  description:
    "Drop a project zip, manifest file, or paste text. Tool Scout reads the structure entirely in your browser and ranks the catalog tools most likely to help.",
};

export default function AnalyzePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
      <header className="mb-8">
        <h1 className="font-mono text-2xl sm:text-3xl text-ink">Project Analyze</h1>
        <p className="text-sm text-ink-muted mt-3 max-w-2xl">
          Drop a project zip, a single manifest file (
          <code className="text-ink">package.json</code>,{" "}
          <code className="text-ink">pyproject.toml</code>,{" "}
          <code className="text-ink">Cargo.toml</code>, …), or paste any project
          text. We extract the structure — languages, frameworks, dependencies,
          markers — entirely in your browser, then rank the catalog tools most
          likely to help.
        </p>
        <p className="text-xs text-ink-subtle mt-2">
          🔒 Everything stays in the browser. Nothing is uploaded anywhere.
        </p>
      </header>

      <AnalyzeClient />
    </div>
  );
}
