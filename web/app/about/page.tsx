import Link from "next/link";

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-12 prose prose-invert">
      <h1 className="font-mono text-3xl text-ink">About Tool Scout</h1>
      <p className="text-ink-muted leading-relaxed mt-4">
        Tool Scout is a personal catalog of Claude-compatible developer tools —
        MCP servers, Claude Code plugins, skills, and useful CLIs. It runs as
        a daily crawler on{" "}
        <a
          href="https://github.com/majieddd"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          Majied's
        </a>{" "}
        machine, scoring everything against a public profile of interests and
        active projects.
      </p>

      <h2 className="font-mono text-lg text-ink mt-8">How it works</h2>
      <ol className="mt-3 space-y-2 text-ink-muted">
        <li>
          A nightly crawler hits GitHub, npm, PyPI, MCP registries, Reddit, HN,
          and a few curated awesome-lists.
        </li>
        <li>
          Records flow through a two-tier classifier: cheap heuristics first,
          then a local Gemma model on the remainder.
        </li>
        <li>
          A grading rubric scores five axes (relevance / quality / novelty /
          install ease / fit) into a letter S–F.
        </li>
        <li>
          Recommendations are computed against the public{" "}
          <a
            href="https://github.com/majieddd/tool-scout/blob/main/config/profile.yaml"
            className="text-accent hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            profile.yaml
          </a>
          .
        </li>
        <li>
          Public JSON is committed to GitHub and Vercel auto-deploys this site.
        </li>
      </ol>

      <h2 className="font-mono text-lg text-ink mt-8">The wrapper button</h2>
      <p className="text-ink-muted leading-relaxed">
        Each tool detail page has a "Request Claude wrapper" button. Click it
        and the request lands in a queue on the maintainer's machine, where a
        local LLM generates a minimal MCP server, runs it through a static
        scan + Docker sandbox (with no network), and — if both pass — publishes
        the file as a downloadable wrapper here.
      </p>
      <p className="text-ink-muted leading-relaxed">
        Limits: 3 requests per IP per 24h, 10 globally per 24h, 1 per tool per
        24h. Generated wrappers are MIT-licensed; you're responsible for
        complying with the wrapped tool's license.
      </p>

      <h2 className="font-mono text-lg text-ink mt-8">Source code</h2>
      <p className="text-ink-muted leading-relaxed">
        Everything's open at{" "}
        <a
          href="https://github.com/majieddd/tool-scout"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/majieddd/tool-scout
        </a>
        . If your tool was indexed and you'd like it removed,{" "}
        <Link href="/policy" className="text-accent hover:underline">
          file a takedown
        </Link>
        .
      </p>
    </article>
  );
}
