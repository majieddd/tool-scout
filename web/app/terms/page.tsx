export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-12 prose prose-invert">
      <h1 className="font-mono text-3xl text-ink">Terms of Service</h1>
      <p className="text-sm text-ink-subtle">Last updated: 2026-05-02</p>

      <h2 className="font-mono text-lg text-ink mt-6">1. Service description</h2>
      <p className="text-ink-muted leading-relaxed">
        Tool Scout aggregates publicly-available information about developer
        tools and offers optional generation of MCP-server wrappers for them.
        Usage is free and provided as-is, with no warranty of availability,
        accuracy, or fitness for any purpose.
      </p>

      <h2 className="font-mono text-lg text-ink mt-6">2. Acceptable use</h2>
      <ul className="text-ink-muted leading-relaxed list-disc list-inside space-y-1">
        <li>No automated or abusive request volumes.</li>
        <li>Don't try to bypass rate limits.</li>
        <li>Don't use wrapper requests to harass tool authors or users.</li>
        <li>Don't use generated wrappers to violate the wrapped tool's license.</li>
        <li>Don't attempt unauthorized access to any system.</li>
      </ul>

      <h2 className="font-mono text-lg text-ink mt-6">3. Generated wrappers</h2>
      <p className="text-ink-muted leading-relaxed">
        Wrappers produced by this service are provided under the MIT License.
        You are responsible for complying with the license of the original
        tool being wrapped. Wrapped tools' authors have not endorsed,
        reviewed, or approved these wrappers, and are not affiliated with
        Tool Scout.
      </p>

      <h2 className="font-mono text-lg text-ink mt-6">4. Liability</h2>
      <p className="text-ink-muted leading-relaxed">
        This is a personal project. Maximum liability is{" "}
        <strong className="text-ink">zero</strong>. Do not use generated code
        in production without your own review.
      </p>

      <h2 className="font-mono text-lg text-ink mt-6">5. Service availability</h2>
      <p className="text-ink-muted leading-relaxed">
        There is no uptime guarantee. The service may be unavailable when the
        maintainer's machine is offline, when rate limits are reached, or for
        any other reason at any time. You should not rely on Tool Scout for
        time-critical work.
      </p>

      <h2 className="font-mono text-lg text-ink mt-6">6. Changes</h2>
      <p className="text-ink-muted leading-relaxed">
        Terms may change. Material changes will be noted on this page with the
        updated date above.
      </p>

      <h2 className="font-mono text-lg text-ink mt-6">7. Contact</h2>
      <p className="text-ink-muted leading-relaxed">
        Open a GitHub issue at{" "}
        <a
          href="https://github.com/majieddd/tool-scout/issues"
          className="text-accent hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/majieddd/tool-scout/issues
        </a>
        .
      </p>
    </article>
  );
}
