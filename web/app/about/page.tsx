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
          Two GitHub Actions workflows crawl the open ecosystem automatically:
          a fast hourly poll of trending sources (GitHub trending, MCP
          registries, HN, Reddit, the Anthropic blog) plus a heavier nightly
          pass over npm, PyPI, and curated awesome-lists.
        </li>
        <li>
          Records flow through a two-tier classifier — cheap heuristics first,
          then a local Gemma model when developing locally. CI uses
          heuristics-only (no LLM keys in the build environment).
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
          Fresh data is committed to <code className="text-ink">main</code>{" "}
          by the workflow itself; GitHub Pages rebuilds and ships the site
          within ~3 minutes of every crawl.
        </li>
      </ol>

      <h2 className="font-mono text-lg text-ink mt-8">The Architect</h2>
      <p className="text-ink-muted leading-relaxed">
        <Link href="/architect" className="text-accent hover:underline">
          /architect
        </Link>{" "}
        accepts a plain-English description of what you want to build and
        decomposes it into a "project breakdown": the technical parts you'll
        need, a typical stack, the essential off-catalog libraries to{" "}
        <code className="text-ink">pip install</code> /{" "}
        <code className="text-ink">npm install</code> yourself, and a curated
        stack of catalog tools — capped at 15 picks so your agent isn't
        drowning in suggestions. Click <em>Generate starter prompt</em> after
        the stack is composed for a paste-ready markdown brief that includes
        install commands and phased implementation steps.
      </p>

      <h2 className="font-mono text-lg text-ink mt-8">Database</h2>
      <p className="text-ink-muted leading-relaxed">
        <Link href="/database" className="text-accent hover:underline">
          /database
        </Link>{" "}
        is the full catalog as a single semantic HTML table — every tool, every
        row, all in the initial response. Built for AI agents that want to
        scan the catalog in one fetch. For programmatic access prefer{" "}
        <a href="/data/tools.json" className="text-accent hover:underline">
          /data/tools.json
        </a>{" "}
        (the same data as one structured JSON document).
      </p>

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
