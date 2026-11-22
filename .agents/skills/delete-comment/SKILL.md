---
name: delete-comment
description: Audit code comments, move decisions to ADRs, log excuses as local issues, delete tautological/stale comments, and ratchet comments-baseline.json downward. Use when cleaning up comments in one file, directory, or before reducing comments-baseline.json.
---

# Delete Comment

Audit, categorize, and eliminate non-exempt code comments while moving valuable context to durable docs and ratcheting `comments-baseline.json` strictly downward.

## Exempt (Keep as-is)

Do not delete and do not count toward the baseline:
- License headers (`SPDX-License-Identifier`, `Copyright`)
- Shebangs (`#!`)
- Tool directives (`# noqa`, `# type:`, `# pragma:`, encoding pragmas, `// @ts-*`, `eslint-disable`/`oxlint-disable`, `prettier-ignore`, `/// <reference>`, JSDoc `@type`/`@typedef`/`@template`/`@satisfies`/`@import` for TypeScript checkJS, GitHub Actions `# vX.Y.Z` SHA-pin annotations)
- Public API contract docstrings / JSDocs (public Python modules/classes/functions, exported JS/TS declarations, Astro `Props` contracts)

## Categorize Each Non-Exempt Comment

1. **Tautology**: Repeats what the code clearly says -> **delete**.
2. **Stale**: References removed/old behavior or outdated rollout state -> **delete**.
3. **Excuse**: Rationalizes a hack, bypass, or loose guard -> **delete** the comment and file or append an issue in the primary worktree under `.scratch/` (`Status: needs-triage`, `file:line`, original comment, concrete fix). Group similar hacks in one issue.
4. **Decision Record**: Documents a non-obvious constraint, invariant, or trade-off -> verify if already covered in `docs/decisions/`. If not, append or create the next grouped ADR in `docs/decisions/`, then **delete** the inline comment.

## Workflow

1. Inspect target files or check remaining files in `comments-baseline.json`:
   ```bash
   python3 scripts/check_comments.py --report
   ```
2. Edit code comments cleanly without changing runtime behavior (never merge tokens when deleting inline `/* ... */`, and keep syntax valid).
3. Update `comments-baseline.json` strictly downward once cleanup is verified:
   ```bash
   python3 scripts/check_comments.py --update
   ```
   `--update` refuses to raise any file count or accept new files with `> 0` comments.
4. Verify tests and ratchet checks:
   ```bash
   python3 scripts/check_comments.py --scope all
   npm --prefix web test
   python -m unittest -v tests.test_comments_ratchet
   ```
