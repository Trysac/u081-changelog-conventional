# Stack

## Used

| Tool | Purpose | Why |
|---|---|---|
| TypeScript (strict) | Language and type checking | Typed public API and declarations for consumers. |
| Node.js 20+ | Runtime | Maintained LTS lines with native ES modules. |
| Vitest + `@vitest/coverage-v8` | Tests and coverage | Fast, ESM-native, runs TypeScript without a separate build step. |
| Biome | Lint and format | One tool for both, single config file. |
| gitleaks | Secret scanning | Standard scanner; runs locally and in CI. |
| GitHub Actions + Dependabot | CI wrapper and updates | Runs the local gates on Linux and Windows. |

Runtime dependencies: none. The allowed runtime dependency list is empty.

## Discarded

| Tool | Why not |
|---|---|
| ESLint + Prettier | Two tools and several configs where Biome covers both. |
| Jest | Needs extra transforms for ESM and TypeScript; slower. |
| Shell scripts for gates | Not portable to Windows; the gate runner is a Node script. |
| Bundlers (tsup, Rollup) | Not needed for a small ESM library; `tsc` emits the published files. |
| semantic-release | Pulls in a plugin ecosystem and CI publishing; see the README. |

New dependencies and rejected tools are listed here with the reason for the decision.
