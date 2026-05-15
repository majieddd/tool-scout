import type { MetadataRoute } from "next";
import { loadTools } from "@/lib/data";

export const dynamic = "force-static";

const SITE = "https://majieddd.github.io/tool-scout";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tools = await loadTools();
  const now = new Date().toISOString();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, lastModified: now, changeFrequency: "daily", priority: 1.0 },
    { url: `${SITE}/today/`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE}/stack/`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE}/architect/`, lastModified: now, changeFrequency: "monthly", priority: 0.85 },
    // Database: full table of every tool, AI-crawl-optimized. Updated daily.
    { url: `${SITE}/database/`, lastModified: now, changeFrequency: "daily", priority: 0.95 },
    { url: `${SITE}/about/`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE}/terms/`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE}/privacy/`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE}/policy/`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  const toolRoutes: MetadataRoute.Sitemap = tools.map((t) => ({
    url: `${SITE}/tool/${t.id}/`,
    lastModified: t.last_updated || t.first_seen || now,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...toolRoutes];
}
