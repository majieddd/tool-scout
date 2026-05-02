# Security Policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:

https://github.com/Majied/tool-scout/security/advisories/new

**Do not** file public issues for security vulnerabilities. Expect a response within 7 days.

## Scope

**In scope:**

- The Tool Scout crawler, classifier, wrapper generator, and public web app
- Any code in this repository
- The Symphony orchestrator service running on the maintainer's machine
- Generated wrappers in `web/public/wrappers/` (if you find one that's clearly malicious)

**Out of scope:**

- Vulnerabilities in third-party tools indexed by the crawler — report to those tools' maintainers directly
- Vulnerabilities in Claude Code itself — report to Anthropic
- Vulnerabilities in dependencies — open a regular issue or wait for Dependabot
- Generated wrappers that simply produce low-quality code — those are quality issues, not security

## Threat model assumptions

This is a personal-scale public service:

- Wrapper-generation requests run untrusted Claude output in a Docker container with `--network=none`, `--read-only`, dropped capabilities, and tight memory/CPU caps.
- Static scan rejects wrappers containing `os.system`, `subprocess`, `eval`, `exec`, network calls, and writes outside an explicit `tmp_path` parameter.
- Per-IP rate limiting and reCAPTCHA v3 prevent automated abuse.
- The bot identity that commits to the public repo has fine-scoped `contents:write` only on this repo.

If you find a way around any of these, please report.

## What gets logged

- IP address (retained 30 days, hashed before DB storage, used for rate limiting)
- reCAPTCHA scores
- Tool ID and request timestamps for wrapper requests

We do not log:

- Names, emails, accounts (we have none)
- Browser fingerprints
- Anything else not strictly required for rate limiting and abuse prevention
