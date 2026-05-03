import type { MetadataRoute } from "next";

export const dynamic = "force-static";

const SITE = "https://majieddd.github.io/tool-scout";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/data/"],   // raw JSON is a side artifact, not for indexing
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
