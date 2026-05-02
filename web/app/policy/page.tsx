export default function PolicyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-12 prose prose-invert">
      <h1 className="font-mono text-3xl text-ink">Content & Abuse Policy</h1>
      <p className="text-sm text-ink-subtle">Last updated: 2026-05-02</p>

      <h2 className="font-mono text-lg text-ink mt-6">Inclusion</h2>
      <p className="text-ink-muted leading-relaxed">
        Tool Scout indexes tools from public sources (GitHub, npm, PyPI, MCP
        registries, curated lists, public posts). Tools appear automatically
        based on public signals — no application required, no fees collected.
      </p>

      <h2 className="font-mono text-lg text-ink mt-6">Takedown</h2>
      <p className="text-ink-muted leading-relaxed">
        Tool authors who wish to be removed may{" "}
        <a
          href="https://github.com/majieddd/tool-scout/issues/new?labels=takedown&template=takedown.yml"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          open a takedown issue
        </a>
        . Removal typically within 48 hours. Removed tools are permanently
        excluded and will not be re-added on future crawls.
      </p>

      <h2 className="font-mono text-lg text-ink mt-6">Wrapper requests</h2>
      <p className="text-ink-muted leading-relaxed">
        If a generated wrapper infringes a license or violates terms, open a
        takedown issue with the wrapper URL. The wrapper file and the tool's
        "Request wrapper" button will be disabled.
      </p>

      <h2 className="font-mono text-lg text-ink mt-6">Abuse</h2>
      <p className="text-ink-muted leading-relaxed">
        Per-IP rate limits apply (3 wrapper requests per 24 hours). Repeated
        abuse — automated requests, attempts to bypass limits, or requests
        clearly intended to harass — results in permanent IP blacklisting.
      </p>
    </article>
  );
}
