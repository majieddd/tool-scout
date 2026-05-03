import Link from "next/link";

export const metadata = {
  title: "Moved — see Project Architect",
  robots: { index: false, follow: true },
};

export default function MovedPage() {
  return (
    <>
      {/* meta-refresh as fallback for clients that don't run JS */}
      <head>
        <meta httpEquiv="refresh" content="0; url=/tool-scout/architect/" />
      </head>
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-20 text-center">
        <h1 className="font-mono text-xl text-ink">Moved → Project Architect</h1>
        <p className="text-sm text-ink-muted mt-3">
          The Analyze page is now{" "}
          <Link href="/architect" className="text-accent hover:underline">
            /architect
          </Link>{" "}
          — same idea, more depth, with optional starter-prompt generation.
        </p>
        <p className="text-xs text-ink-subtle mt-6">Redirecting…</p>
        <script
          dangerouslySetInnerHTML={{
            __html: `setTimeout(() => { location.replace('/tool-scout/architect/'); }, 50);`,
          }}
        />
      </div>
    </>
  );
}
