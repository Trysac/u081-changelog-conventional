# Project record: changelog-conventional

## Objective

Given the same git history and the same arguments, produce the same next SemVer version and the same Keep a Changelog section on every run. The library is for maintainers of Node.js libraries who want version numbers and changelog entries derived from Conventional Commits messages, without a plugin ecosystem or CI coupling.

## Scope

In scope:

- Parsing Conventional Commits 1.0.0 messages, including breaking changes in headers and footers.
- Computing the next SemVer 2.0.0 version with the default bump rules, and the optional preMajorZero rule.
- Rendering Keep a Changelog sections and inserting them into a changelog file.
- An injectable git port, with an in-memory implementation and an implementation that runs the git executable without a shell.
- A command-line function `run()` in `src/cli.ts` that connects these parts.

Out of scope:

- Creating tags, pushing commits or tags, and publishing releases.
- Monorepos and per-package versioning.
- Prerelease versions: they are rejected when used as the current version.
- Sanitizing Markdown in commit subjects beyond escaping `&`, `<` and `>`.

## Timeline

| Date | Milestone |
|---|---|
| 2026 | Repository created from the factory utility template. |

## Effort metrics

Effort figures come from the factory ledger and the time log. No figure has been recorded yet.

| Metric | Value | Source |
|---|---|---|
| Tokens (input / output) | 347034 / 124288 | factory ledger |
| Hours (human) | pending measurement | time log |
| Cost (USD) | 0.8780 | factory ledger |

## Factory run u081 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | claude-sonnet-5-5 | yes | 2857 | 100196 | 0 | 4473 | 0.5043 |
| fix-1 | claude-sonnet-5-5 | no | 6 | 915 | 10961 | 47939 | 0.0414 |
| fix-2 | claude-sonnet-5-5 | no | 8 | 1323 | 8953 | 58158 | 0.0414 |
| audit | claude-sonnet-5-5 | no | 10 | 5902 | 44593 | 89023 | 0.1794 |
| fix-3 | claude-sonnet-5-5 | no | 6 | 3490 | 13674 | 45450 | 0.0736 |
| fix-4 | claude-sonnet-5-5 | no | 8 | 1070 | 4612 | 59741 | 0.0282 |
| docs | claude-haiku-5-5 | no | 39355 | 11392 | 0 | 0 | 0.0096 |

Total: $0.8780. Prices: Anthropic list prices.
