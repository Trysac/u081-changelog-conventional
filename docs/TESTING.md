# Testing

## Tools

- [Vitest](https://vitest.dev/) runs the suites in `test/`.
- Coverage is collected with V8 (`@vitest/coverage-v8`) over `src/`.
- `execFile` from `node:child_process` is mocked with `vi.mock` in both suites, so no real git process runs in the tests.

## Test files

| File | Covers |
|---|---|
| `test/index.test.ts` | `ChangelogError`; `parseCommit` (headers, scopes, breaking markers, footers, body, CRLF, size limits); `nextVersion` (bump rules, preMajorZero, build metadata, large numbers, invalid and prerelease versions, limits); `renderRelease` (section order, escaping, line flattening, 200 character cut, surrogate pairs, commit links, repoUrl validation, date and version validation); `updateChangelog` (insertion position, empty file header, duplicate versions, CRLF, 5 MiB byte limit); `createMemoryGit` (tag lookup, commit slicing, ref and prefix validation); `createProcessGit` (execFile arguments and output parsing); acceptance examples from the specification. |
| `test/cli.test.ts` | `run()` through injected fakes: writing and creating the changelog, default clock, exit code 1 with nothing releasable, `--from`, `--tag-prefix`, `--file`, `--dry-run`, `--print-version`, `--help`, usage errors, unsafe refs and dates, git errors without detail leakage, the 5 MiB limit, duplicate versions, file system errors, the default process git, and a real temporary file in the OS temp directory. |

## Commands

```sh
npm test            # vitest run --coverage
npx vitest          # watch mode while developing
npm run check       # every gate, including tests
```

## Rules

- Coverage must stay at or above 80 % for lines, branches, functions and statements, as configured in `vitest.config.ts`. Lowering the thresholds is not allowed.
- Tests use the public entry point (`src/index.ts`) and the `run()` function in `src/cli.ts`. They assert return values, thrown errors and their codes or messages.
- Each bug fix adds a test that fails without the fix.
- Tests are deterministic: no network, no real clock unless injected, no shared state between tests. Temporary files go to the OS temp directory and are removed by the test.

## Reports

Coverage reports are written to `coverage/` (text summary and `lcov`). The folder is ignored by git.
