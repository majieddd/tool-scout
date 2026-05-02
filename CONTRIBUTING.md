# Contributing

Tool Scout is a personal project developed primarily by its owner. Pull requests are welcome but not guaranteed to be merged or reviewed quickly. For large changes, please open an issue first to discuss.

## Development setup

See [README.md](README.md) and [`docs/03_PREFLIGHT_SETUP.md`](docs/03_PREFLIGHT_SETUP.md).

## Code style

- **Python:** `ruff format`, `ruff check`, `mypy --strict` for `src/`
- **TypeScript:** Next.js defaults, strict mode, no `any` without justification
- All `pytest` tests must pass before merge
- All `npm run build` builds must pass before merge

## Commit messages

Conventional-commits-ish format:

- `feat:` new functionality
- `fix:` bug fix
- `chore:` tooling/maintenance
- `docs:` documentation only
- `test:` adding/refactoring tests
- `refactor:` no behavior change

Scope is the phase number (`phase-08`) or module name (`installer`, `crawler`).

Examples:

```
feat(phase-08): docker sandbox + static scan
fix(crawler): handle 429 from npm registry
chore: update dependabot schedule to weekly
docs: clarify gating points in BUILD_ME
```

## Tests required

Every PR that touches `src/` should include or update tests in `tests/`. PRs that change config files (`config/*.yaml`, `WORKFLOW.md`) don't require tests but should include a `scout workflow validate` (or equivalent) success in the PR description.

## What you should NOT contribute

- New crawl sources without first opening an issue — sources have rate limits and politeness considerations
- "Improvements" to the wrapper-gen prompt — that's tuning territory, owned by the maintainer
- Anything that introduces a recurring monthly cost
- Direct Anthropic API integration (Tool Scout deliberately uses Claude Code subprocess for the zero-cost design)

## Security issues

Please do **not** open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md).
