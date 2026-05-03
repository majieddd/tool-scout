"use client";

import Link from "next/link";
import { GradeBadge } from "./GradeBadge";
import type { ProjectProfile } from "@/lib/analyze";
import type { Match } from "@/lib/match";

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "lang" | "fw" | "marker" }) {
  const cls =
    tone === "lang"
      ? "bg-grade-b/20 text-grade-b border-grade-b/30"
      : tone === "fw"
        ? "bg-accent/20 text-accent border-accent/30"
        : tone === "marker"
          ? "bg-grade-a/20 text-grade-a border-grade-a/30"
          : "bg-white/5 text-ink-muted border-white/10";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono border ${cls}`}>
      {children}
    </span>
  );
}

export function AnalyzeResults({
  profile,
  matches,
  onReset,
}: {
  profile: ProjectProfile;
  matches: Match[];
  onReset: () => void;
}) {
  const langChips = Object.entries(profile.languages)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  return (
    <div className="space-y-8">
      <section className="bg-bg-card border border-white/5 rounded-lg p-5">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="font-mono text-lg text-ink">What I see in your project</h2>
          <button
            onClick={onReset}
            className="text-sm text-ink-muted hover:text-ink"
          >
            ← analyze another
          </button>
        </div>

        <dl className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <dt className="text-ink-subtle w-32 shrink-0">Source</dt>
            <dd className="text-ink-muted">
              {profile.source === "zip"
                ? `zip archive · ${profile.fileCount} files`
                : profile.source === "file"
                  ? "single file"
                  : "pasted text"}
            </dd>
          </div>

          {langChips.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-2 items-center">
              <dt className="text-ink-subtle w-32 shrink-0">Languages</dt>
              <dd className="flex flex-wrap gap-1.5">
                {langChips.map(([lang, n]) => (
                  <Chip key={lang} tone="lang">
                    {lang} <span className="opacity-60 ml-1">×{n}</span>
                  </Chip>
                ))}
              </dd>
            </div>
          )}

          {profile.frameworks.size > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-2 items-center">
              <dt className="text-ink-subtle w-32 shrink-0">Frameworks</dt>
              <dd className="flex flex-wrap gap-1.5">
                {[...profile.frameworks].sort().map((fw) => (
                  <Chip key={fw} tone="fw">{fw}</Chip>
                ))}
              </dd>
            </div>
          )}

          {profile.packageManagers.size > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-2 items-center">
              <dt className="text-ink-subtle w-32 shrink-0">Package mgr</dt>
              <dd className="flex flex-wrap gap-1.5">
                {[...profile.packageManagers].sort().map((pm) => (
                  <Chip key={pm}>{pm}</Chip>
                ))}
              </dd>
            </div>
          )}

          {(profile.hasDocker || profile.hasCI || profile.hasTests || profile.hasMcp || profile.hasSkill || profile.hasPlugin) && (
            <div className="flex flex-wrap gap-x-3 gap-y-2 items-center">
              <dt className="text-ink-subtle w-32 shrink-0">Markers</dt>
              <dd className="flex flex-wrap gap-1.5">
                {profile.hasDocker && <Chip tone="marker">Docker</Chip>}
                {profile.hasCI && <Chip tone="marker">CI</Chip>}
                {profile.hasTests && <Chip tone="marker">Tests</Chip>}
                {profile.hasMcp && <Chip tone="marker">MCP-aware</Chip>}
                {profile.hasSkill && <Chip tone="marker">Has SKILL.md</Chip>}
                {profile.hasPlugin && <Chip tone="marker">Has plugin.json</Chip>}
              </dd>
            </div>
          )}

          {profile.keywords.size > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-2 items-start">
              <dt className="text-ink-subtle w-32 shrink-0 pt-0.5">Keywords</dt>
              <dd className="flex flex-wrap gap-1.5">
                {[...profile.keywords].sort().slice(0, 24).map((kw) => (
                  <Chip key={kw}>{kw}</Chip>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section>
        <h2 className="font-mono text-lg text-ink mb-3">
          Top {matches.length} matches from the catalog
        </h2>
        {matches.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No strong matches yet. Try uploading a richer project (e.g., one with a
            populated README or a manifest) — the matcher leans on tag overlap and
            keyword presence.
          </p>
        ) : (
          <ol className="space-y-2">
            {matches.map((m, i) => {
              const t = m.tool;
              return (
                <li key={t.id}>
                  <Link
                    href={`/tool/${t.id}/`}
                    className="block bg-bg-card border border-white/5 rounded-lg p-4 hover:border-accent/40 hover:bg-bg-subtle transition group"
                  >
                    <div className="flex items-start gap-4">
                      <span className="font-mono text-sm text-ink-subtle w-8 tabular-nums shrink-0 pt-1">
                        {(i + 1).toString().padStart(2, " ")}
                      </span>
                      <GradeBadge letter={t.grade?.letter || "F"} size="md" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-3">
                          <h3 className="font-mono text-sm text-ink truncate group-hover:text-accent transition">
                            {t.name}
                          </h3>
                          <span className="text-xs text-ink-subtle font-mono tabular-nums shrink-0">
                            score {m.score.toFixed(2)}
                          </span>
                        </div>
                        {t.description && (
                          <p className="text-xs text-ink-muted mt-1 line-clamp-1">
                            {t.description}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
                          {t.category && <Chip>{t.category}</Chip>}
                          {m.reasons.map((r, idx) => (
                            <Chip key={idx}>{r}</Chip>
                          ))}
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
