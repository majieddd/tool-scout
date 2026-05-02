"""Static-scan guardrail for generated wrapper code (docs/01_SPEC.md §25).

Pre-sandbox regex check on the *executable* tokens of the file — string
literals and comments are stripped first so a docstring mentioning
"no subprocess.run" doesn't trigger a false positive. Patterns are otherwise
intentionally strict: false negatives (letting through genuinely unsafe
code) are unacceptable.

Returns (clean: bool, hits: list[str]) where each hit is the regex string
that matched executable code.
"""
from __future__ import annotations

import io
import re
import tokenize
from typing import Final

DANGER_PATTERNS: Final[list[str]] = [
    r"\bos\.system\b",
    r"\bsubprocess\.(?:run|Popen|call|check_output|check_call)\b",
    r"\b__import__\b",
    r"\beval\s*\(",
    r"\bexec\s*\(",
    r"\bcompile\s*\([^)]*['\"]exec['\"]",
    r"\bshutil\.rmtree\b",
    r"\bsocket\.",
    r"\burllib\.",
    r"\brequests\.",
    r"\bhttpx\.",
    r"\baiohttp\.",
    # File writes outside the controlled tmp_path parameter
    r"\bopen\s*\([^)]*['\"][wax]\+?['\"]",
    r"\bpathlib\.[A-Za-z_]+\.write_(?:bytes|text)\b",
    # Reading the wrapper file path itself can leak secrets
    r"\b__file__\b.*\bopen\b",
]

_COMPILED = [re.compile(p) for p in DANGER_PATTERNS]


def _strip_strings_and_comments(code: str) -> str:
    """Tokenize and drop STRING + COMMENT tokens. Returns reassembled live code
    (joined without inserted whitespace so dotted attribute access like
    `subprocess.run` survives intact for the regex pass).

    Falls back to the original code if tokenization fails (e.g. syntactically
    broken output from the LLM) — better safe than silently passing malformed
    code.
    """
    try:
        toks = list(tokenize.tokenize(io.BytesIO(code.encode("utf-8")).readline))
    except (tokenize.TokenizeError, SyntaxError, IndentationError):
        return code
    out: list[str] = []
    for tok in toks:
        if tok.type in (tokenize.STRING, tokenize.COMMENT, tokenize.ENCODING, tokenize.ENDMARKER, tokenize.NEWLINE, tokenize.NL, tokenize.INDENT, tokenize.DEDENT):
            # Replace with a single space so adjacent NAME tokens (e.g. `import os`)
            # don't fuse into one identifier (`importos`) and accidentally bypass
            # word-boundary regexes.
            out.append(" ")
            continue
        out.append(tok.string)
    return "".join(out)


def scan(code: str) -> tuple[bool, list[str]]:
    """Returns (clean, list of pattern strings that hit executable code)."""
    if not isinstance(code, str):
        return False, ["non-string input"]
    live = _strip_strings_and_comments(code)
    hits: list[str] = []
    for raw, compiled in zip(DANGER_PATTERNS, _COMPILED):
        if compiled.search(live):
            hits.append(raw)
    return (len(hits) == 0), hits
