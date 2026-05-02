export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-12 prose prose-invert">
      <h1 className="font-mono text-3xl text-ink">Privacy Policy</h1>
      <p className="text-sm text-ink-subtle">Last updated: 2026-05-02</p>

      <h2 className="font-mono text-lg text-ink mt-6">What we collect</h2>
      <ul className="text-ink-muted leading-relaxed list-disc list-inside space-y-1">
        <li>IP address — retained 30 days, solely for rate limiting; hashed before storage.</li>
        <li>Request timestamps and tool IDs.</li>
        <li>reCAPTCHA scores (anonymous, via Google).</li>
        <li>No cookies except those required for site function.</li>
      </ul>

      <h2 className="font-mono text-lg text-ink mt-6">What we do NOT collect</h2>
      <ul className="text-ink-muted leading-relaxed list-disc list-inside space-y-1">
        <li>Names, emails, accounts (we have none).</li>
        <li>Browser fingerprints.</li>
        <li>Per-user analytics or behavior profiles.</li>
      </ul>

      <h2 className="font-mono text-lg text-ink mt-6">Third parties that see request metadata</h2>
      <ul className="text-ink-muted leading-relaxed list-disc list-inside space-y-1">
        <li>Vercel — hosting + Edge Config.</li>
        <li>Google — reCAPTCHA scoring.</li>
        <li>ngrok — webhook tunnel; sees request headers and body in transit.</li>
        <li>GitHub — generated wrappers are stored in a public repo.</li>
      </ul>

      <h2 className="font-mono text-lg text-ink mt-6">Data deletion</h2>
      <p className="text-ink-muted leading-relaxed">
        Open a GitHub issue with your approximate request timestamps; logs
        covering that window will be purged within 7 days.
      </p>
    </article>
  );
}
