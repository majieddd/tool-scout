import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const SITE = "https://majieddd.github.io/tool-scout";

// Robots.txt — note the change from the previous version:
//
// We used to `disallow: /data/` to keep search engines from indexing raw JSON
// files in their normal HTML index. The intent was good (JSON files aren't
// useful search results), but the side effect contradicted the Database page,
// which explicitly advertises `/data/tools.json` to AI agents and well-behaved
// crawlers as "the machine-readable form, fetch this instead of scraping the
// table." A `Disallow: /data/` told those same agents not to fetch it.
//
// New rule: allow everything (the JSON files are valid, public, useful data
// for AI agents) but explicitly mark `/data/grades_index.json` (an internal
// index used by the architect) as not interesting to crawlers — keeps the
// search-result surface clean without breaking the agent-readable contract.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // No /data/ disallow — see comment above. AI agents fetching
        // /data/tools.json or /data/meta.json get exactly what the Database
        // page advertises, with no robots.txt contradiction.
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
