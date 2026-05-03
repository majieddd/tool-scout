"use client";

/**
 * Static-export RequestButton.
 *
 * The original spec used a serverless POST to /api/request-wrapper which
 * forwarded to the maintainer's local orchestrator via ngrok. In the
 * GitHub Pages deploy there's no server, so the button instead opens a
 * pre-filled GitHub issue. The maintainer's local orchestrator (or a
 * future GitHub Action with an LLM secret) processes the request and
 * commits the wrapper file to web/public/wrappers/<tool_id>/server.py,
 * which the next Pages build picks up.
 */

const REPO = "majieddd/tool-scout";

export function RequestButton({ toolId, toolName }: { toolId: string; toolName: string }) {
  const issueTitle = encodeURIComponent(`wrapper request: ${toolName}`);
  const issueBody = encodeURIComponent(
    `Tool ID: \`${toolId}\`\n\n` +
      `Tool name: ${toolName}\n\n` +
      `Catalog page: https://majieddd.github.io/tool-scout/tool/${toolId}/\n\n` +
      `---\n\n` +
      `Submitted from the public Tool Scout catalog. The maintainer's local agent ` +
      `picks these up, generates a minimal MCP server in a sandboxed container, ` +
      `runs static_scan + Docker smoke test, and commits the result.`
  );
  const labels = "wrapper-request";
  const url = `https://github.com/${REPO}/issues/new?title=${issueTitle}&body=${issueBody}&labels=${labels}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-4 py-2 rounded font-medium text-sm bg-accent/90 hover:bg-accent text-bg transition"
    >
      Request Claude wrapper
      <span aria-hidden className="text-xs opacity-80">↗</span>
    </a>
  );
}
