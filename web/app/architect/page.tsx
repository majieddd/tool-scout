import { ArchitectClient } from "./ArchitectClient";

export const metadata = {
  title: "Project Architect — Tool Scout",
  description:
    "Describe your project, drop your code or spec, get a curated tool stack tuned to your goal — and optionally a paste-ready starter prompt with install commands and a phased implementation plan.",
};

export default function ArchitectPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
      <header className="mb-8">
        <h1 className="font-mono text-2xl sm:text-3xl text-ink">Project Architect</h1>
        <p className="text-sm text-ink-muted mt-3 max-w-3xl">
          Describe what you're building. Optionally drop in your code or a spec sheet. The
          Architect detects your target agent, platform, language, and domains, then composes
          a deliberate stack from the catalog — capped at 15 picks so the agent isn't drowning
          in tools — with compatibility warnings flagged.
        </p>
        <p className="text-sm text-ink-muted mt-2 max-w-3xl">
          Optional: click <em>Generate starter prompt</em> after the stack is composed and
          we'll ask 4-5 quick questions, then produce a paste-ready markdown prompt with
          install commands, configuration steps, phased implementation, and a starter message
          for your agent — all designed to save tokens and keep the agent on-task across
          sessions.
        </p>
        <p className="text-xs text-ink-subtle mt-3">
          🔒 Everything runs in your browser. Nothing is uploaded.
        </p>
      </header>

      <ArchitectClient />
    </div>
  );
}
