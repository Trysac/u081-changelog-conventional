# changelog-conventional

[![npm version](https://img.shields.io/npm/v/@trysac/changelog-conventional.svg)](https://www.npmjs.com/package/@trysac/changelog-conventional)
[![license: MIT](https://img.shields.io/npm/l/@trysac/changelog-conventional.svg)](LICENSE)
[![CI](https://github.com/Trysac/u081-changelog-conventional/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u081-changelog-conventional/actions/workflows/ci.yml)

Computes the next SemVer version and renders or updates a Keep a Changelog section from Conventional Commits 1.0.0 messages, reading git only through an injectable port.

## Problem

Version numbers and release notes are often chosen by hand, so breaking changes can ship in patch releases and CHANGELOG files drift from the commit history. This package parses commit messages per Conventional Commits 1.0.0, bumps the version per SemVer 2.0.0 and inserts a deterministic section into the changelog. It has no runtime dependencies.

## Install

```sh
npm install @trysac/changelog-conventional
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations.

## Usage

```ts
import { nextVersion, parseCommit, renderRelease, updateChangelog } from "@trysac/changelog-conventional";

const commit = parseCommit({ hash: "a".repeat(40), message: "feat(api): add search" });
const commits = commit === null ? [] : [commit];
const { version } = nextVersion("1.4.2", commits); // "1.5.0"
const section = renderRelease(version, "2026-11-05", commits);
console.log(updateChangelog("", section, version));
```

## API

| Export | Signature | Description |
|---|---|---|
| `parseCommit` | `(raw: {hash, message}) => ParsedCommit or null` | Parses a Conventional Commits 1.0.0 message. Returns null when the header is not `type(scope)!: description`. |
| `nextVersion` | `(current, commits, opts?: {preMajorZero?}) => {version, bump}` | Computes the next version from a stable SemVer version. `bump` is `major`, `minor`, `patch` or `none`. |
| `renderRelease` | `(version, date, commits, opts?: {repoUrl?}) => string` | Renders a `## [version] - date` section with Keep a Changelog subsections. |
| `updateChangelog` | `(existing, section, version) => string` | Inserts the section into the changelog text. Throws `duplicate_version` when the version heading exists. |
| `createMemoryGit` | `(tags, commits) => GitPort` | In-memory git port for tests and dry runs. |
| `createProcessGit` | `(cwd) => GitPort` | Git port that runs the `git` executable with `execFile` and no shell. |
| `ChangelogError` | `class` | Error with a stable `code` property. |

The `ParsedCommit` type has `hash`, `type` (lower-cased), optional `scope`, `subject`, optional `body`, `breaking` and `footers`.

### Errors

All library errors are `ChangelogError` instances with one of these codes: `invalid_version`, `prerelease_unsupported`, `duplicate_version`, `git_failed`, `invalid_ref`, `invalid_date`, `too_large`. An invalid `repoUrl` raises `invalid_ref`.

### Options

- `nextVersion` option `preMajorZero`: when the major version is 0, a breaking change bumps minor instead of major.
- `renderRelease` option `repoUrl`: a plain http or https URL. Commit hashes then link to `repoUrl/commit/HASH`.

### Limits

- Commit messages up to 1,000,000 characters; hashes up to 128 characters.
- At most 10,000 commits per run.
- Versions up to 256 characters. Prerelease versions are rejected by `nextVersion`; prerelease tags are ignored by the tag lookup.
- Changelog text and release sections up to 5 MiB, measured in bytes.
- Subjects are flattened to one line and cut at 200 characters.
- Git refs and tag prefixes match `^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$` and must not contain `..`. An empty tag prefix is accepted.
- Git runs with a 30 second timeout and a 50 MB output buffer.

## CLI

The command-line behaviour is implemented by `run(argv, io, deps)` exported from `src/cli.ts`. The package declares no executable `bin` entry.

`changelog-conventional [--file CHANGELOG.md] [--tag-prefix v] [--from REF] [--date YYYY-MM-DD] [--dry-run] [--print-version] [--help]`

- `--file`: changelog path, default `CHANGELOG.md`.
- `--tag-prefix`: prefix used to find the latest tag, default `v`.
- `--from`: git ref to start from instead of the latest tag.
- `--date`: release date, default today in UTC.
- `--dry-run`: print the section and write nothing.
- `--print-version`: print only the next version and write nothing.

Exit codes: `0` success, `1` no releasable commits, `2` usage, IO, git or parse error.

## Why not semantic-release

semantic-release is a plugin system that also publishes packages and creates releases in CI. This package only calculates the version and writes changelog text. It has zero runtime dependencies, creates no tags and publishes nothing, and reads git through an injectable port, so tests need no repository.

## Security

The threat model, the defended cases and the known limits are described in [docs/SECURITY.md](docs/SECURITY.md).

## Development

```sh
npm install
npm run check   # lint, format, types, tests with coverage, docs, secrets
```

See [AGENTS.md](AGENTS.md) for the full command list and [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## License

[MIT](LICENSE) © 2026 Miguel Gomez
