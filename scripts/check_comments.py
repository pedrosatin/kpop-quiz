#!/usr/bin/env python3
"""Audit and ratchet code comments across the repository using Python stdlib only."""

from __future__ import annotations

import argparse
import ast
import io
import json
import os
import re
import subprocess
import sys
import tokenize
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BASELINE = ROOT / "comments-baseline.json"

EXCLUDED_DIRS = {
    ".git",
    ".astro",
    ".scratch",
    "__pycache__",
    ".pytest_cache",
    "node_modules",
    "dist",
    "graphify-out",
    "playwright-report",
    "blob-report",
    "test-results",
    "coverage",
}

EXCLUDED_PREFIXES = (
    "data/",
    "docs/",
    "schemas/",
    "skills/",
    "web/public/",
    "web/src/tests/fixtures/",
    "web/e2e/fixtures/fixed-data/",
    "web/src/data/map-pilot/",
    "tests/fixtures/",
)

JSONC_CONFIGS = {
    "web/tsconfig.json",
}

PY_DIRECTIVE_RE = re.compile(
    r"^#\s*(?:"
    r"noqa(?:\s*:|\b)"
    r"|type:\s"
    r"|pragma:\s"
    r"|pylint:\s"
    r"|mypy:\s"
    r"|pyright:"
    r"|ruff:\s"
    r"|fmt:\s*(?:off|on|skip)\b"
    r"|isort:\s"
    r"|nosec\b"
    r"|-\*-\s*coding[:=]"
    r"|coding[:=]\s*[-\w.]+"
    r")",
    re.IGNORECASE,
)

JS_DIRECTIVE_RE = re.compile(
    r"^(?:"
    r"//\s*@ts-(?:expect-error|ignore|nocheck|check)\b"
    r"|///\s*<reference\b"
    r"|(?://|/\*)\s*(?:eslint|oxlint)-(?:disable|enable)(?:-(?:next-)?line)?\b"
    r"|(?://|/\*)\s*prettier-ignore\b"
    r"|(?://|/\*)\s*(?:v8|c8)\s+ignore\b"
    r"|/\*\s*@vite-ignore\b"
    r"|/\*\s*stylelint-(?:disable|enable)\b"
    r")"
)

CSS_DIRECTIVE_RE = re.compile(
    r"^/\*\s*(?:stylelint-(?:disable|enable)|prettier-ignore)\b"
)

WORKFLOW_SHA_PIN_RE = re.compile(
    r"^\s*-?\s*uses:\s+\S+@[0-9a-f]{40}\s+(#\s*v\d+(?:\.\d+)*)\s*$"
)

LICENSE_HEADER_RE = re.compile(
    r"(?:SPDX-License-Identifier:|Copyright\s+(?:\(c\)|©|\d{4}))",
    re.IGNORECASE,
)

KEYWORDS_BEFORE_REGEX = {
    "return",
    "throw",
    "case",
    "default",
    "delete",
    "void",
    "typeof",
    "await",
    "yield",
    "in",
    "instanceof",
    "new",
    "else",
    "do",
    "of",
    "export",
}

@dataclass(frozen=True)
class CommentHit:
    line: int
    end_line: int
    text: str
    category: str
    exempt_reason: str | None = None

    @property
    def line_count(self) -> int:
        return self.end_line - self.line + 1

def is_test_path(rel: str) -> bool:
    return (
        rel.startswith("tests/")
        or rel.startswith("web/e2e/")
        or rel.startswith("web/tests/")
        or ".test." in Path(rel).name
        or ".spec." in Path(rel).name
    )

def in_scope_files(scope: str) -> list[str]:
    try:
        out = subprocess.check_output(
            ["git", "ls-files"],
            cwd=ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        )
        tracked = set(out.splitlines())
    except (OSError, subprocess.CalledProcessError):
        tracked = set()

    discovered: set[str] = set()
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = Path(dirpath).relative_to(ROOT).as_posix()
        if rel_dir == ".":
            rel_dir = ""
        dirnames[:] = [
            d
            for d in sorted(dirnames)
            if d not in EXCLUDED_DIRS
            and not (f"{rel_dir}/{d}/" if rel_dir else f"{d}/").startswith(EXCLUDED_PREFIXES)
        ]
        for fname in sorted(filenames):
            rel = f"{rel_dir}/{fname}" if rel_dir else fname
            if rel.startswith(EXCLUDED_PREFIXES):
                continue
            discovered.add(rel)

    candidates = sorted(discovered | {f for f in tracked if (ROOT / f).is_file()})
    selected: list[str] = []
    for rel in candidates:
        if rel.startswith(EXCLUDED_PREFIXES) or any(part in EXCLUDED_DIRS for part in Path(rel).parts[:-1]):
            continue
        is_py = (
            rel == "main.py"
            or (
                rel.endswith(".py")
                and (
                    rel.startswith("kpop_scraping/")
                    or rel.startswith("scripts/")
                    or rel.startswith("tests/")
                )
            )
        )
        is_web = rel.startswith("web/") and (
            rel.endswith((".ts", ".tsx", ".js", ".mjs", ".astro", ".css", ".sh"))
            or rel in JSONC_CONFIGS
        )
        if scope == "python" and is_py:
            selected.append(rel)
        elif scope == "web" and is_web:
            selected.append(rel)
        elif scope == "all" and (is_py or is_web):
            selected.append(rel)
    return selected

def _python_docstring_spans(src: str, is_test: bool) -> dict[tuple[int, int], bool]:
    spans: dict[tuple[int, int], bool] = {}
    tree = ast.parse(src)

    def is_private_name(name: str) -> bool:
        return name.startswith("_") and not (name.startswith("__") and name.endswith("__"))

    def visit(node: ast.AST, in_func: bool, parent_private: bool) -> None:
        next_in_func = in_func
        next_priv = parent_private
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.body and isinstance(node.body[0], ast.Expr):
                expr_val = node.body[0].value
                if isinstance(expr_val, ast.Constant) and isinstance(expr_val.value, str):
                    end_line = expr_val.end_lineno or expr_val.lineno
                    is_public = False
                    if not is_test:
                        if isinstance(node, ast.Module):
                            is_public = True
                        elif not in_func and not parent_private and not is_private_name(node.name):
                            is_public = True
                    spans[(expr_val.lineno, end_line)] = is_public

            next_in_func = in_func or isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                next_priv = parent_private or is_private_name(node.name)

        for child in ast.iter_child_nodes(node):
            visit(child, next_in_func, next_priv)

    visit(tree, False, False)
    return spans

def scan_python(rel: str, src: str) -> list[CommentHit]:
    hits: list[CommentHit] = []
    lines = src.splitlines()
    is_test = is_test_path(rel)
    doc_spans = _python_docstring_spans(src, is_test)
    for (start_ln, end_ln), is_public in sorted(doc_spans.items()):
        txt = "\n".join(lines[start_ln - 1 : end_ln])
        hits.append(
            CommentHit(
                line=start_ln,
                end_line=end_ln,
                text=txt,
                category="docstring",
                exempt_reason="public_api_doc" if is_public else None,
            )
        )

    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type != tokenize.COMMENT:
            continue
        ln = tok.start[0]
        txt = tok.string
        exempt: str | None = None
        if ln == 1 and txt.startswith("#!"):
            exempt = "shebang"
        elif ln <= 5 and LICENSE_HEADER_RE.search(txt):
            exempt = "license"
        elif PY_DIRECTIVE_RE.match(txt):
            exempt = "tool_directive"
        hits.append(CommentHit(line=ln, end_line=ln, text=txt, category="hash", exempt_reason=exempt))

    hits.sort(key=lambda h: (h.line, h.category))
    return hits

def _scan_js_ts_raw(src: str) -> list[tuple[int, int, str, str]]:
    comments: list[tuple[int, int, str, str]] = []
    n = len(src)
    i = 0
    line = 1
    can_regex = True
    tmpl_stack: list[int] = []
    brace_depth = 0

    while i < n:
        ch = src[i]
        if ch == "\n":
            line += 1
            i += 1
            continue
        if ch in " \t\r":
            i += 1
            continue
        if i == 0 and src.startswith("#!"):
            end = src.find("\n", i)
            if end == -1:
                end = n
            comments.append((1, 1, src[i:end], "shebang"))
            i = end
            continue
        if ch == "/" and i + 1 < n and src[i + 1] == "/":
            end = src.find("\n", i)
            if end == -1:
                end = n
            comments.append((line, line, src[i:end], "line"))
            i = end
            continue
        if ch == "/" and i + 1 < n and src[i + 1] == "*":
            start_line = line
            end = src.find("*/", i + 2)
            end = n if end == -1 else end + 2
            txt = src[i:end]
            nl = txt.count("\n")
            comments.append((start_line, start_line + nl, txt, "block"))
            line += nl
            i = end
            continue
        if ch == "/" and can_regex:
            j = i + 1
            in_class = False
            while j < n:
                c = src[j]
                if c == "\\":
                    j += 2
                    continue
                if c == "[":
                    in_class = True
                elif c == "]" and in_class:
                    in_class = False
                elif c == "/" and not in_class:
                    j += 1
                    while j < n and src[j].isalpha():
                        j += 1
                    break
                elif c == "\n":
                    break
                j += 1
            i = j
            can_regex = False
            continue
        if ch in ("'", '"'):
            q = ch
            j = i + 1
            while j < n:
                c = src[j]
                if c == "\\":
                    if j + 1 < n and src[j + 1] == "\n":
                        line += 1
                    j += 2
                    continue
                if c == "\n":
                    line += 1
                    j += 1
                    break
                if c == q:
                    j += 1
                    break
                j += 1
            i = j
            can_regex = False
            continue
        if ch == "`":
            j = i + 1
            while j < n:
                c = src[j]
                if c == "\\":
                    if j + 1 < n and src[j + 1] == "\n":
                        line += 1
                    j += 2
                    continue
                if c == "\n":
                    line += 1
                    j += 1
                    continue
                if c == "`":
                    j += 1
                    can_regex = False
                    break
                if c == "$" and j + 1 < n and src[j + 1] == "{":
                    tmpl_stack.append(brace_depth)
                    brace_depth += 1
                    j += 2
                    can_regex = True
                    break
                j += 1
            i = j
            continue
        if ch == "{":
            brace_depth += 1
            i += 1
            can_regex = True
            continue
        if ch == "}":
            if tmpl_stack and brace_depth - 1 == tmpl_stack[-1]:
                tmpl_stack.pop()
                brace_depth -= 1
                j = i + 1
                while j < n:
                    c = src[j]
                    if c == "\\":
                        if j + 1 < n and src[j + 1] == "\n":
                            line += 1
                        j += 2
                        continue
                    if c == "\n":
                        line += 1
                        j += 1
                        continue
                    if c == "`":
                        j += 1
                        can_regex = False
                        break
                    if c == "$" and j + 1 < n and src[j + 1] == "{":
                        tmpl_stack.append(brace_depth)
                        brace_depth += 1
                        j += 2
                        can_regex = True
                        break
                    j += 1
                i = j
                continue
            brace_depth = max(0, brace_depth - 1)
            i += 1
            can_regex = True
            continue
        if ch.isalpha() or ch in ("_", "$"):
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] in ("_", "$")):
                j += 1
            ident = src[i:j]
            can_regex = ident in KEYWORDS_BEFORE_REGEX
            i = j
            continue
        if ch.isdigit():
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] in (".", "_")):
                j += 1
            i = j
            can_regex = False
            continue
        if src.startswith("++", i) or src.startswith("--", i):
            i += 2
            can_regex = False
            continue
        if ch in (")", "]"):
            i += 1
            can_regex = False
            continue
        if src.startswith("=>", i):
            i += 2
            can_regex = True
            continue
        i += 1
        can_regex = True

    return comments

def _public_export_lines(lines: list[str]) -> tuple[set[int], set[int]]:
    export_decl_lines: set[int] = set()
    public_member_lines: set[int] = set()
    block_depth = 0
    in_public_container = False
    container_depth = 0

    for idx, raw in enumerate(lines, 1):
        stripped = raw.strip()
        if re.match(r"^(?:export\b(?:\s+declare)?|interface\s+Props\b)", stripped) and block_depth == 0:
            export_decl_lines.add(idx)
            if re.match(r"^export\s+(?:(?:abstract\s+)?class|interface|type|enum)\b|^interface\s+Props\b", stripped):
                in_public_container = True
                container_depth = block_depth
        elif in_public_container and block_depth == container_depth + 1:
            if stripped and not stripped.startswith(("private ", "#")):
                public_member_lines.add(idx)

        in_str = ""
        k = 0
        while k < len(raw):
            c = raw[k]
            if in_str:
                if c == "\\":
                    k += 2
                    continue
                if c == in_str:
                    in_str = ""
            else:
                if raw.startswith("//", k):
                    break
                if c in ('"', "'"):
                    in_str = c
                elif c == "{":
                    block_depth += 1
                elif c == "}":
                    block_depth = max(0, block_depth - 1)
                    if in_public_container and block_depth <= container_depth:
                        in_public_container = False
            k += 1

    return export_decl_lines, public_member_lines

def _is_public_jsdoc(
    txt: str,
    end_ln: int,
    lines: list[str],
    export_decl_lines: set[int],
    public_member_lines: set[int],
    is_test: bool,
    is_astro_frontmatter: bool = False,
) -> bool:
    if is_test:
        return False
    if not (txt.startswith("/**") and not txt.startswith("/***")):
        return False
    if is_astro_frontmatter and re.search(r"@(?:fileoverview|module|component)\b", txt):
        return True
    next_ln = None
    for idx in range(end_ln + 1, min(len(lines) + 1, end_ln + 6)):
        stripped = lines[idx - 1].strip()
        if not stripped or stripped.startswith("@"):
            continue
        next_ln = idx
        break
    if next_ln is None:
        return False
    if next_ln in export_decl_lines or next_ln in public_member_lines:
        return True
    if is_astro_frontmatter and re.match(r"^(?:export\s+)?interface\s+Props\b", lines[next_ln - 1].strip()):
        return True
    return False

def scan_js_ts(rel: str, src: str, line_offset: int = 0, is_astro_frontmatter: bool = False) -> list[CommentHit]:
    lines = src.splitlines()
    is_test = is_test_path(rel)
    export_decl_lines, public_member_lines = _public_export_lines(lines)
    hits: list[CommentHit] = []
    for start_ln, end_ln, txt, kind in _scan_js_ts_raw(src):
        exempt: str | None = None
        if kind == "shebang":
            exempt = "shebang"
        elif start_ln <= 5 and LICENSE_HEADER_RE.search(txt):
            exempt = "license"
        elif JS_DIRECTIVE_RE.match(txt.strip()):
            exempt = "tool_directive"
        elif kind == "block" and _is_public_jsdoc(
            txt, end_ln, lines, export_decl_lines, public_member_lines, is_test, is_astro_frontmatter
        ):
            exempt = "public_api_doc"
        hits.append(
            CommentHit(
                line=start_ln + line_offset,
                end_line=end_ln + line_offset,
                text=txt,
                category="jsdoc" if kind == "block" and txt.startswith("/**") else kind,
                exempt_reason=exempt,
            )
        )
    return hits

def scan_css(src: str, line_offset: int = 0) -> list[CommentHit]:
    hits: list[CommentHit] = []
    n = len(src)
    i = 0
    line = 1
    while i < n:
        ch = src[i]
        if ch == "\n":
            line += 1
            i += 1
            continue
        if ch in ("'", '"'):
            q = ch
            j = i + 1
            while j < n:
                c = src[j]
                if c == "\\":
                    if j + 1 < n and src[j + 1] == "\n":
                        line += 1
                    j += 2
                    continue
                if c == "\n":
                    line += 1
                    j += 1
                    break
                if c == q:
                    j += 1
                    break
                j += 1
            i = j
            continue
        if ch == "/" and i + 1 < n and src[i + 1] == "*":
            start_ln = line
            end = src.find("*/", i + 2)
            end = n if end == -1 else end + 2
            txt = src[i:end]
            nl = txt.count("\n")
            exempt: str | None = None
            if start_ln <= 5 and LICENSE_HEADER_RE.search(txt):
                exempt = "license"
            elif CSS_DIRECTIVE_RE.match(txt.strip()):
                exempt = "tool_directive"
            hits.append(CommentHit(line=start_ln + line_offset, end_line=start_ln + nl + line_offset, text=txt, category="block", exempt_reason=exempt))
            line += nl
            i = end
            continue
        i += 1
    return hits

def scan_astro(rel: str, src: str) -> list[CommentHit]:
    hits: list[CommentHit] = []
    body_start = 0
    body_line = 1

    if src.startswith("---\n") or src.startswith("---\r\n"):
        first_nl = src.find("\n") + 1
        end_fm = re.search(r"(?m)^---\s*$", src[first_nl:])
        if end_fm:
            fm_text = src[first_nl : first_nl + end_fm.start()]
            hits.extend(scan_js_ts(rel, fm_text, line_offset=1, is_astro_frontmatter=True))
            body_start = first_nl + end_fm.end()
            body_line = src[:body_start].count("\n") + 1

    body = src[body_start:]
    n = len(body)
    i = 0
    line = body_line
    while i < n:
        if body.startswith("<!--", i):
            start_ln = line
            end = body.find("-->", i + 4)
            end = n if end == -1 else end + 3
            txt = body[i:end]
            nl = txt.count("\n")
            hits.append(CommentHit(line=start_ln, end_line=start_ln + nl, text=txt, category="html"))
            line += nl
            i = end
            continue
        if body.startswith("{/*", i):
            start_ln = line
            end = body.find("*/}", i + 3)
            end = n if end == -1 else end + 3
            txt = body[i:end]
            nl = txt.count("\n")
            hits.append(CommentHit(line=start_ln, end_line=start_ln + nl, text=txt, category="jsx_block"))
            line += nl
            i = end
            continue
        script_m = re.match(r"<script\b[^>]*>", body[i:], re.IGNORECASE)
        if script_m:
            tag_end = i + script_m.end()
            close_m = re.search(r"</script\s*>", body[tag_end:], re.IGNORECASE)
            inner_end = tag_end + close_m.start() if close_m else n
            inner_offset = line + body[i:tag_end].count("\n") - 1
            hits.extend(scan_js_ts(rel, body[tag_end:inner_end], line_offset=inner_offset))
            after = inner_end + (close_m.end() - close_m.start() if close_m else 0)
            line += body[i:after].count("\n")
            i = after
            continue
        style_m = re.match(r"<style\b[^>]*>", body[i:], re.IGNORECASE)
        if style_m:
            tag_end = i + style_m.end()
            close_m = re.search(r"</style\s*>", body[tag_end:], re.IGNORECASE)
            inner_end = tag_end + close_m.start() if close_m else n
            inner_offset = line + body[i:tag_end].count("\n") - 1
            hits.extend(scan_css(body[tag_end:inner_end], line_offset=inner_offset))
            after = inner_end + (close_m.end() - close_m.start() if close_m else 0)
            line += body[i:after].count("\n")
            i = after
            continue
        if body[i] == "\n":
            line += 1
        i += 1
    hits.sort(key=lambda h: h.line)
    return hits

def scan_shell(src: str) -> list[CommentHit]:
    hits: list[CommentHit] = []
    for ln, raw in enumerate(src.splitlines(), 1):
        if ln == 1 and raw.startswith("#!"):
            hits.append(CommentHit(line=1, end_line=1, text=raw, category="shebang", exempt_reason="shebang"))
            continue
        in_sq = False
        in_dq = False
        i = 0
        n = len(raw)
        while i < n:
            c = raw[i]
            if c == "\\" and not in_sq:
                i += 2
                continue
            if c == "'" and not in_dq:
                in_sq = not in_sq
            elif c == '"' and not in_sq:
                in_dq = not in_dq
            elif c == "#" and not in_sq and not in_dq:
                if i == 0 or raw[i - 1].isspace():
                    txt = raw[i:]
                    exempt = "license" if ln <= 5 and LICENSE_HEADER_RE.search(txt) else None
                    hits.append(CommentHit(line=ln, end_line=ln, text=txt, category="hash", exempt_reason=exempt))
                    break
            i += 1
    return hits

def scan_yaml(rel: str, src: str) -> list[CommentHit]:
    hits: list[CommentHit] = []
    lines = src.splitlines()
    block_indent: int | None = None
    for ln, raw in enumerate(lines, 1):
        indent = len(raw) - len(raw.lstrip(" "))
        stripped = raw.lstrip(" ")
        if block_indent is not None:
            if stripped == "" or indent > block_indent:
                if stripped.startswith("#"):
                    hits.append(CommentHit(line=ln, end_line=ln, text=stripped, category="hash"))
                continue
            block_indent = None

        in_sq = False
        in_dq = False
        i = 0
        n = len(raw)
        comment_idx = -1
        while i < n:
            c = raw[i]
            if c == "'" and not in_dq:
                if in_sq and i + 1 < n and raw[i + 1] == "'":
                    i += 2
                    continue
                in_sq = not in_sq
            elif c == '"' and not in_sq:
                in_dq = not in_dq
            elif c == "\\" and in_dq:
                i += 2
                continue
            elif c == "#" and not in_sq and not in_dq:
                if i == 0 or raw[i - 1].isspace():
                    comment_idx = i
                    break
            i += 1

        if comment_idx >= 0:
            txt = raw[comment_idx:]
            exempt: str | None = None
            if rel.startswith(".github/workflows/") and WORKFLOW_SHA_PIN_RE.match(raw):
                exempt = "tool_directive"
            hits.append(CommentHit(line=ln, end_line=ln, text=txt, category="hash", exempt_reason=exempt))
            code_part = raw[:comment_idx].rstrip()
        else:
            code_part = raw.rstrip()

        if re.search(r"(?:^|\s)[^:\s][^:]*:\s*[|>][+-]?\d*$", code_part):
            block_indent = indent
    return hits

def scan_jsonc(src: str) -> list[CommentHit]:
    hits: list[CommentHit] = []
    n = len(src)
    i = 0
    line = 1
    in_str = False
    while i < n:
        ch = src[i]
        if ch == "\n":
            line += 1
            i += 1
            continue
        if in_str:
            if ch == "\\":
                i += 2
                continue
            if ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            i += 1
            continue
        if ch == "/" and i + 1 < n and src[i + 1] == "/":
            end = src.find("\n", i)
            end = n if end == -1 else end
            hits.append(CommentHit(line=line, end_line=line, text=src[i:end], category="line"))
            i = end
            continue
        if ch == "/" and i + 1 < n and src[i + 1] == "*":
            start_ln = line
            end = src.find("*/", i + 2)
            end = n if end == -1 else end + 2
            txt = src[i:end]
            nl = txt.count("\n")
            hits.append(CommentHit(line=start_ln, end_line=start_ln + nl, text=txt, category="block"))
            line += nl
            i = end
            continue
        i += 1
    return hits

def scan_file(rel: str) -> list[CommentHit]:
    src = (ROOT / rel).read_text(encoding="utf-8")
    if rel.endswith(".py"):
        return scan_python(rel, src)
    if rel.endswith((".ts", ".tsx", ".js", ".mjs")):
        return scan_js_ts(rel, src)
    if rel.endswith(".astro"):
        return scan_astro(rel, src)
    if rel.endswith(".css"):
        return scan_css(src)
    if rel.endswith(".sh"):
        return scan_shell(src)
    if rel.endswith((".yml", ".yaml")):
        return scan_yaml(rel, src)
    if rel in JSONC_CONFIGS:
        return scan_jsonc(src)
    return []

def collect_metrics(scope: str) -> dict:
    files_data: dict[str, dict] = {}
    exempt_counts: dict[str, int] = {
        "license": 0,
        "shebang": 0,
        "tool_directive": 0,
        "public_api_doc": 0,
    }
    total_comments = 0
    total_comment_lines = 0
    total_exempt_lines = 0

    for rel in in_scope_files(scope):
        hits = scan_file(rel)
        active = [h for h in hits if h.exempt_reason is None]
        exempt = [h for h in hits if h.exempt_reason is not None]
        for h in exempt:
            exempt_counts[h.exempt_reason] = exempt_counts.get(h.exempt_reason, 0) + 1
            total_exempt_lines += h.line_count
        c_count = len(active)
        c_lines = sum(h.line_count for h in active)
        total_comments += c_count
        total_comment_lines += c_lines
        files_data[rel] = {
            "comments": c_count,
            "lines": c_lines,
            "exempt": len(exempt),
        }

    return {
        "files": files_data,
        "summary": {
            "scope": scope,
            "files_scanned": len(files_data),
            "files_with_comments": sum(1 for v in files_data.values() if v["comments"] > 0),
            "comments": total_comments,
            "comment_lines": total_comment_lines,
            "exempt_by_type": exempt_counts,
            "exempt_total": sum(exempt_counts.values()),
            "exempt_lines": total_exempt_lines,
        },
    }

def load_baseline(path: Path) -> dict[str, int]:
    if not path.is_file():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and "files" in raw:
        return {k: int(v) for k, v in raw["files"].items()}
    return {}

def save_baseline(path: Path, counts: dict[str, int]) -> None:
    non_zero = {k: v for k, v in sorted(counts.items()) if v > 0}
    payload = {
        "version": 1,
        "total_comments": sum(non_zero.values()),
        "files": non_zero,
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n", encoding="utf-8")

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Comment ratchet checker")
    parser.add_argument("--scope", choices=("all", "python", "web"), default="all")
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--update", action="store_true", help="Ratchet baseline strictly downward")
    parser.add_argument("--init", action="store_true", help="Initialize baseline file when absent")
    parser.add_argument("--report", action="store_true", help="Print detailed metrics as JSON")
    args = parser.parse_args(argv)

    metrics = collect_metrics(args.scope)
    current = {rel: info["comments"] for rel, info in metrics["files"].items()}

    if args.report:
        print(json.dumps(metrics["summary"], indent=2))
        return 0

    if args.init:
        if args.scope != "all":
            print("ERROR: --init requires --scope all", file=sys.stderr)
            return 2
        if args.baseline.is_file():
            print(f"ERROR: baseline already exists ({args.baseline}); use --update to ratchet downward", file=sys.stderr)
            return 2
        save_baseline(args.baseline, current)
        print(f"Initialized {args.baseline.name}: {sum(current.values())} comments across {sum(v > 0 for v in current.values())} files.")
        return 0

    baseline = load_baseline(args.baseline)
    if not baseline and not args.baseline.is_file():
        print(f"ERROR: baseline file missing: {args.baseline}", file=sys.stderr)
        return 2

    regressions: list[str] = []
    improvements: list[str] = []
    for rel, count in sorted(current.items()):
        allowed = baseline.get(rel, 0)
        if count > allowed:
            if rel in baseline:
                regressions.append(f"  {rel}: {count} > baseline {allowed} (+{count - allowed})")
            else:
                regressions.append(f"  {rel}: {count} > 0 (new/unbaselined file must have 0 comments)")
        elif count < allowed:
            improvements.append(f"  {rel}: {allowed} -> {count} (-{allowed - count})")

    if regressions:
        print("Comment ratchet check FAILED:", file=sys.stderr)
        for line in regressions:
            print(line, file=sys.stderr)
        return 1

    if args.update:
        if args.scope != "all":
            print("ERROR: --update requires --scope all", file=sys.stderr)
            return 2
        next_baseline: dict[str, int] = {}
        for rel in sorted(current):
            allowed = baseline.get(rel, 0)
            count = current[rel]
            if count > 0:
                next_baseline[rel] = min(allowed, count) if rel in baseline else 0
        save_baseline(args.baseline, next_baseline)
        print(
            f"Updated {args.baseline.name}: total {sum(baseline.values())} -> {sum(next_baseline.values())}."
        )
        return 0

    summary = metrics["summary"]
    print(
        f"Comment ratchet OK ({args.scope}): {summary['comments']} comments "
        f"({summary['comment_lines']} lines) within baseline; {summary['exempt_total']} exempt kept."
    )
    if improvements:
        print(f"Files below baseline ({len(improvements)}; run --update to ratchet down):")
        for line in improvements[:15]:
            print(line)
        if len(improvements) > 15:
            print(f"  ... and {len(improvements) - 15} more")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
