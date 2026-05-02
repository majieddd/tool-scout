"""TimeBudget — soft + hard caps on total crawl time (docs/01_SPEC.md §12).

Budgets are tracked per source so a runaway source can't starve the rest:
each `consume(source, seconds)` increments the per-source counter, and
`remaining(source)` returns how much that source has left vs. its allocation.

`expired()` is a global hard-kill — true once total_elapsed >= hard_kill_seconds,
regardless of per-source allocation. Crawler runner checks this between sources.

Two factory presets:
  - `TimeBudget.full()`     — 60 min normal, 75 min hard kill
  - `TimeBudget.quick()`    — 10 min normal, 15 min hard kill (for `--quick`)
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class TimeBudget:
    total_minutes: int = 60
    hard_kill_minutes: int = 75
    started_at: float | None = None
    consumed_per_source: dict[str, float] = field(default_factory=dict)
    allocations_per_source: dict[str, float] = field(default_factory=dict)

    @classmethod
    def full(cls) -> "TimeBudget":
        return cls(total_minutes=60, hard_kill_minutes=75)

    @classmethod
    def quick(cls) -> "TimeBudget":
        return cls(total_minutes=10, hard_kill_minutes=15)

    # ---- lifecycle ---------------------------------------------------
    def start(self) -> None:
        self.started_at = time.monotonic()

    def allocate(self, source: str, minutes: float) -> None:
        self.allocations_per_source[source] = minutes * 60

    def consume(self, source: str, seconds: float) -> None:
        self.consumed_per_source[source] = self.consumed_per_source.get(source, 0) + seconds

    # ---- queries -----------------------------------------------------
    def elapsed_s(self) -> float:
        if self.started_at is None:
            return 0.0
        return time.monotonic() - self.started_at

    def remaining_total_s(self) -> float:
        return max(0.0, self.total_minutes * 60 - self.elapsed_s())

    def remaining_for_source(self, source: str) -> float:
        alloc = self.allocations_per_source.get(source, 0)
        used = self.consumed_per_source.get(source, 0)
        return max(0.0, alloc - used)

    def source_exhausted(self, source: str) -> bool:
        return self.remaining_for_source(source) <= 0

    def expired(self) -> bool:
        return self.elapsed_s() >= self.hard_kill_minutes * 60

    def soft_expired(self) -> bool:
        return self.elapsed_s() >= self.total_minutes * 60

    def summary(self) -> dict:
        return {
            "elapsed_s": round(self.elapsed_s(), 1),
            "total_budget_s": self.total_minutes * 60,
            "hard_kill_s": self.hard_kill_minutes * 60,
            "soft_expired": self.soft_expired(),
            "expired": self.expired(),
            "consumed_per_source": {k: round(v, 1) for k, v in self.consumed_per_source.items()},
        }
