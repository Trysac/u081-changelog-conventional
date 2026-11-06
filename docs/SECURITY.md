# Security practices

How this repository keeps the package and its users safe. The disclosure policy is in [../SECURITY.md](../SECURITY.md).

## Threat model

The package processes commit messages, tag names and changelog text, and it runs the `git` executable. The inputs are trusted only as far as the repository is trusted.

### Defended

- Option injection into git: refs and tag prefixes must match `^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$` and must not contain `..`, so no value can start with `-`. Invalid values raise `invalid_ref` before git runs.
- Shell injection: git runs through `execFile` with `shell: false`.
- Resource exhaustion: commit messages up to 1,000,000 characters, hashes up to 128, versions up to 256, at most 10,000 commits, changelog and section up to 5 MiB, git output up to 50 MB and git runs up to 30 seconds.
- Markup in subjects: `&`, `<` and `>` are escaped, CR and LF are replaced with spaces, and subjects are cut at 200 characters.
- Link targets: `repoUrl` must be a plain http or https URL with a restricted character set, with no spaces, brackets or parentheses.
- Error details: git failures raise `git_failed` with a generic message, and the CLI prints `unexpected failure` for other errors instead of the original message.
- Duplicate headings: `updateChangelog` refuses a version that already has a `## [version]` heading.

### Not defended

- Markdown injection: only `&`, `<` and `>` are escaped. Brackets, parentheses, backticks and link syntax in subjects pass into the changelog unchanged.
- Output paths: `--file` accepts any path. The CLI does not check that the path stays inside the repository.
- Read race and memory use: the size check uses `stat` before `readFile`, so the file may change between the two calls. The whole file is read into memory.
- Repository trust: git runs with the repository configuration and the `git` binary found on `PATH`. The library does not verify either.
- Version integrity: any commit author can add a `BREAKING CHANGE` footer or a `!` marker and so raise the bump. Version decisions are only as trustworthy as the commit history.
- Secrets in history: commit subjects are copied verbatim into the changelog. The library does not detect secrets.

## Secrets

- No secrets, tokens or credentials in the repository, commit history, logs or prompts.
- `gitleaks` runs as the last step of `npm run check` and as a dedicated CI job. Its configuration is `.gitleaks.toml`.
- Publishing credentials live only in the CI secret store or the maintainer's local npm configuration.

## Dependencies

- The package has no runtime dependencies. Development dependencies are limited to the toolchain listed in [STACK.md](STACK.md).
- Dependabot opens weekly updates for npm packages and GitHub Actions.
- The `package-lock.json` file is committed so installs are reproducible.

## Code

- The library does not use `eval`, dynamic `Function` construction or a shell.
- Inputs from callers are validated and rejected with explicit `ChangelogError` codes.

## Publishing

- Packages are published from a clean checkout after `npm run check` passes.
- Only `dist/` is included in the published tarball.
