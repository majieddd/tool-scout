"""Profile loader — reads config/profile.yaml once, exposes structured access."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

DEFAULT_PROFILE_PATH = Path(__file__).resolve().parents[3] / "config" / "profile.yaml"


@dataclass
class Project:
    name: str
    boost_tags: set[str] = field(default_factory=set)
    weight: float = 0.0


@dataclass
class Profile:
    interests: dict[str, float] = field(default_factory=dict)   # tag -> weight
    projects: list[Project] = field(default_factory=list)
    excludes: set[str] = field(default_factory=set)             # tag -> hard exclude

    @classmethod
    def load(cls, path: Path | str = DEFAULT_PROFILE_PATH) -> "Profile":
        body = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        interests = {k.lower(): float(v) for k, v in (body.get("interests") or {}).items()}
        projects = [
            Project(
                name=p.get("name", "?"),
                boost_tags={t.lower() for t in (p.get("boost_tags") or [])},
                weight=float(p.get("weight") or 0),
            )
            for p in (body.get("current_projects") or [])
        ]
        excludes = {t.lower() for t in (body.get("exclude") or [])}
        return cls(interests=interests, projects=projects, excludes=excludes)

    def matches_excluded(self, tags: set[str]) -> bool:
        return bool(tags & self.excludes)

    def project_boost(self, tags: set[str]) -> float:
        """Max weight across projects whose boost_tags intersect with the tool's tags."""
        return max(
            (p.weight for p in self.projects if tags & p.boost_tags),
            default=0.0,
        )

    def interest_sum(self, tags: set[str]) -> float:
        return sum(self.interests.get(t, 0) for t in tags)
