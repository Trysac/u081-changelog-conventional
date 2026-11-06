# Zero-dependency changelog tool with an injectable git port

Status: accepted (generated, pending human review)

## Context

Release versions and CHANGELOG entries are often decided by hand, so breaking changes slip into patch releases. semantic-release and release-please solve this but bring plugin ecosystems and CI coupling. The tool must parse Conventional Commits 1.0.0, bump per SemVer 2.0.0 and update a Keep a Changelog file deterministically, and it must be testable without a real repository.

## Decision

Implement pure functions (parseCommit, nextVersion, renderRelease, updateChangelog) over plain data, and hide git behind a small GitPort interface with an in-memory implementation and an execFile implementation (no shell, validated refs and prefixes that can never start with '-', buffer, timeout and commit-count caps). The CLI is a testable run(argv, io, deps) function that validates all user input before the first git call. Untrusted text is flattened, cut and entity-escaped when rendered. All failures use one ChangelogError with a stable code. Only Node built-ins are used.

## Consequences

The library has no runtime dependencies and every behaviour is tested deterministically with fakes and a mocked execFile. The scope is deliberately narrow: no tagging, pushing, releases or monorepo support, and only the default semantic-release bump rules. Ref validation is stricter than git itself, so unusual but legal ref names are rejected. Prerelease versions are rejected rather than handled.
