from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts import check_comments


class CommentRatchetBaselineTests(unittest.TestCase):
    def test_repository_baseline_passes_for_all_scopes(self):
        for scope in ("all", "python", "web"):
            with self.subTest(scope=scope):
                self.assertEqual(check_comments.main(["--scope", scope]), 0)

    def test_web_scope_includes_client_data_modules(self):
        web_files = check_comments.in_scope_files("web")
        self.assertTrue(any(f.endswith("/src/data/crossword.ts") for f in web_files))
        self.assertFalse(any("/src/data/map-pilot/" in f for f in web_files))

    def test_exemptions_are_ignored_in_counts(self):
        py_src = (
            "#!/usr/bin/env python3\n"
            "# Copyright 2026 Example\n"
            '"""Public module API contract."""\n'
            "\n"
            "if True:\n"
            "    def public_fn():\n"
            '        """Public function contract."""\n'
            "        return 1  # noqa: E501\n"
            "\n"
            "def _private_fn():\n"
            '    """Internal helper note."""\n'
            "    # internal comment\n"
            "    return 2\n"
        )
        hits = check_comments.scan_python("kpop_scraping/sample.py", py_src)
        active = [h for h in hits if h.exempt_reason is None]
        exempt = {h.exempt_reason for h in hits if h.exempt_reason is not None}
        self.assertEqual(len(active), 2)
        self.assertEqual(exempt, {"shebang", "license", "public_api_doc", "tool_directive"})

    def test_js_ts_scanner_ignores_regex_and_preserves_public_jsdoc_and_directives(self):
        ts_src = (
            "/// <reference types=\"astro/client\" />\n"
            "// oxlint-disable-next-line prefer-rest-params\n"
            "const pattern = /https:\\/\\/not-a-comment/;\n"
            "/** Public contract. */\n"
            "export function greet() {\n"
            "  // internal note\n"
            "  return pattern.source;\n"
            "}\n"
            "/** @typedef {{ id: string }} SampleId */\n"
            "const file = /** @type {SampleId} */ ({ id: \"a\" });\n"
        )
        hits = check_comments.scan_js_ts("sample.ts", ts_src)
        active = [h for h in hits if h.exempt_reason is None]
        self.assertEqual([h.text for h in active], ["// internal note"])
        exempt_reasons = [h.exempt_reason for h in hits if h.exempt_reason is not None]
        self.assertEqual(
            exempt_reasons,
            ["tool_directive", "tool_directive", "public_api_doc", "tool_directive", "tool_directive"],
        )

    def test_other_language_scanners_handle_astro_css_shell_yaml_and_jsonc(self):
        astro_src = (
            "---\n"
            "interface Props {\n"
            "  /** Public prop contract. */\n"
            "  title: string;\n"
            "}\n"
            "// fm comment\n"
            "---\n"
            "<!-- html note -->\n"
            "{/* jsx note */}\n"
            "<script>// script note</script>\n"
            "<style>/* style note */</style>\n"
        )
        astro_hits = check_comments.scan_astro("Layout.astro", astro_src)
        self.assertEqual(sum(1 for h in astro_hits if h.exempt_reason is None), 5)
        self.assertEqual(sum(1 for h in astro_hits if h.exempt_reason == "public_api_doc"), 1)

        css_hits = check_comments.scan_css('/* stylelint-disable */\n.a { content: "/* x */"; } /* real */')
        self.assertEqual([h.text for h in css_hits if h.exempt_reason is None], ["/* real */"])
        self.assertEqual([h.exempt_reason for h in css_hits if h.exempt_reason], ["tool_directive"])

        sh_hits = check_comments.scan_shell('#!/usr/bin/env bash\necho "# not comment"\n# shell comment\n')
        self.assertEqual([h.text for h in sh_hits if h.exempt_reason is None], ["# shell comment"])
        self.assertEqual([h.exempt_reason for h in sh_hits if h.exempt_reason], ["shebang"])

        yml_src = (
            "steps:\n"
            "  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n"
            "  # plain note\n"
        )
        yml_hits = check_comments.scan_yaml(".github/workflows/ci.yml", yml_src)
        self.assertEqual([h.text for h in yml_hits if h.exempt_reason is None], ["# plain note"])
        self.assertEqual([h.exempt_reason for h in yml_hits if h.exempt_reason], ["tool_directive"])

        jsonc_hits = check_comments.scan_jsonc('{\n  "url": "https://a//b",\n  // line note\n  "ok": true\n}\n')
        self.assertEqual([h.text for h in jsonc_hits], ["// line note"])


class CommentRatchetBehaviorTests(unittest.TestCase):
    def _run_with_mocked_files(self, fake_counts: dict[str, int], baseline_counts: dict[str, int], argv: list[str]):
        orig_metrics = check_comments.collect_metrics
        with tempfile.TemporaryDirectory() as tmp:
            baseline_path = Path(tmp) / "comments-baseline.json"
            check_comments.save_baseline(baseline_path, baseline_counts)

            def fake_collect(scope: str):
                files_data = {
                    rel: {"comments": count, "lines": count, "exempt": 0}
                    for rel, count in fake_counts.items()
                }
                return {
                    "files": files_data,
                    "summary": {
                        "scope": scope,
                        "files_scanned": len(files_data),
                        "files_with_comments": sum(1 for c in fake_counts.values() if c > 0),
                        "comments": sum(fake_counts.values()),
                        "comment_lines": sum(fake_counts.values()),
                        "exempt_by_type": {"license": 0, "shebang": 0, "tool_directive": 0, "public_api_doc": 0},
                        "exempt_total": 0,
                        "exempt_lines": 0,
                    },
                }

            check_comments.collect_metrics = fake_collect
            try:
                rc = check_comments.main(["--baseline", str(baseline_path), *argv])
                saved = json.loads(baseline_path.read_text(encoding="utf-8"))
            finally:
                check_comments.collect_metrics = orig_metrics
            return rc, saved

    def test_fails_when_existing_file_increases(self):
        rc, _ = self._run_with_mocked_files({"a.py": 4}, {"a.py": 3}, [])
        self.assertEqual(rc, 1)

    def test_fails_when_new_file_has_comments(self):
        rc, _ = self._run_with_mocked_files({"a.py": 2, "new.py": 1}, {"a.py": 2}, [])
        self.assertEqual(rc, 1)

    def test_update_only_ratchets_downward_and_refuses_increase(self):
        rc_fail, saved_unchanged = self._run_with_mocked_files({"a.py": 5}, {"a.py": 3}, ["--update"])
        self.assertEqual(rc_fail, 1)
        self.assertEqual(saved_unchanged["files"], {"a.py": 3})

        rc_ok, saved_down = self._run_with_mocked_files({"a.py": 1, "b.py": 0}, {"a.py": 3, "b.py": 2}, ["--update"])
        self.assertEqual(rc_ok, 0)
        self.assertEqual(saved_down["files"], {"a.py": 1})
