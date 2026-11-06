# Architecture

## Overview

`@trysac/changelog-conventional` is a dependency-free TypeScript library published to npm as ES modules with type declarations. It parses Conventional Commits 1.0.0 messages, computes the next SemVer 2.0.0 version, renders Keep a Changelog sections and inserts them into a changelog. Git access goes through the injectable `GitPort` interface.

## Modules

| Module | Responsibility |
|---|---|
| `src/index.ts` | Public API. Exports `parseCommit`, `nextVersion`, `renderRelease`, `updateChangelog`, `createMemoryGit`, `createProcessGit` and `ChangelogError`. Also defines the parser, the bump rules and the git port types. |
| `src/errors.ts` | `ChangelogError` and the `ChangelogErrorCode` union. Messages are cut to 200 characters. |
| `src/validate.ts` | Validation of git refs, tag prefixes and ISO dates. Not exported from the public entry point. |
| `src/cli.ts` | `run(argv, io, deps)` command-line logic. The only module that reads or writes files. Not exported from the public entry point. |

## Boundaries

- No runtime dependencies. `node:child_process` is the only Node module used by the library, and only in `createProcessGit`.
- No I/O happens at import time. The library functions are pure, except the git port returned by `createProcessGit`.
- The CLI accepts injected `git`, `readFile`, `writeFile` and `now` dependencies. Defaults are the process git, `node:fs` and the system clock.
- Library errors are `ChangelogError` instances with a stable `code`.

## Git access

`createProcessGit(cwd)` runs `git tag --list` and `git log --no-merges --format=%H%x1f%B%x1e REF..HEAD` through `execFile` without a shell. Refs and prefixes are validated before any git call. Output records are split on the record separator, and each hash must be a 40 to 64 character lowercase hex string.

## Build and distribution

The build compiles `src/` to `dist/`. The published package contains `dist/` only, as set by the `files` field in `package.json`.

## Decisions

Architectural decisions are recorded in [decisions/](decisions/), starting with [0001](decisions/0001-record-architecture-decisions.md).
